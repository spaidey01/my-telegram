import { test, expect } from "@playwright/test";
import crypto from "node:crypto";

const turnUrl = process.env.TURN_URL || "turn:127.0.0.1:3478";
const turnSecret = process.env.TURN_SECRET || "";
const relayOnly = (username, credential) => ({
  iceServers: [{ urls: turnUrl.split(",").map((v) => v.trim()), username, credential }],
  iceTransportPolicy: "relay",
});

const makeCredential = () => {
  const expiresAt = Math.floor(Date.now() / 1000) + 600;
  const username = `${expiresAt}:browser-e2e`;
  const credential = crypto.createHmac("sha1", turnSecret).update(username).digest("base64");
  return { username, credential };
};

async function waitForGathering(page) {
  await page.evaluate(() => new Promise((resolve) => {
    if (window.__pc.iceGatheringState === "complete") return resolve();
    window.__pc.addEventListener("icegatheringstatechange", () => {
      if (window.__pc.iceGatheringState === "complete") resolve();
    });
  }));
}

async function createPeer(page, config, initiator) {
  await page.goto("about:blank");
  await page.evaluate(({ config, initiator }) => {
    const pc = new RTCPeerConnection(config);
    window.__pc = pc;
    window.__messages = [];
    window.__states = [];
    pc.oniceconnectionstatechange = () => window.__states.push(pc.iceConnectionState);
    pc.ondatachannel = (event) => {
      event.channel.onmessage = (message) => window.__messages.push(message.data);
      window.__dc = event.channel;
    };
    if (initiator) {
      const dc = pc.createDataChannel("stargram");
      dc.onmessage = (message) => window.__messages.push(message.data);
      window.__dc = dc;
    }
  }, { config, initiator });
}

async function negotiate(offerPage, answerPage) {
  const offer = await offerPage.evaluate(async () => {
    const description = await window.__pc.createOffer();
    await window.__pc.setLocalDescription(description);
    return { type: window.__pc.localDescription.type, sdp: window.__pc.localDescription.sdp };
  });
  await waitForGathering(offerPage);
  const gatheredOffer = await offerPage.evaluate(() => ({
    type: window.__pc.localDescription.type,
    sdp: window.__pc.localDescription.sdp,
  }));
  await answerPage.evaluate(async (remote) => {
    await window.__pc.setRemoteDescription(remote);
    const answer = await window.__pc.createAnswer();
    await window.__pc.setLocalDescription(answer);
  }, gatheredOffer);
  await waitForGathering(answerPage);
  const answer = await answerPage.evaluate(() => ({
    type: window.__pc.localDescription.type,
    sdp: window.__pc.localDescription.sdp,
  }));
  await offerPage.evaluate(async (remote) => window.__pc.setRemoteDescription(remote), answer);
}

test("real browser WebRTC uses TURN relay, transfers data, enters ICE failure, and reconnects", async ({ browser }) => {
  test.skip(!turnSecret, "TURN_SECRET is required for real TURN E2E");
  const credential = makeCredential();
  const goodConfig = relayOnly(credential.username, credential.credential);
  const badConfig = relayOnly(credential.username, "definitely-invalid-credential");

  const context = await browser.newContext();
  const caller = await context.newPage();
  const callee = await context.newPage();

  try {
    await createPeer(caller, goodConfig, true);
    await createPeer(callee, goodConfig, false);
    await negotiate(caller, callee);

    await caller.waitForFunction(() => window.__pc.iceConnectionState === "connected" || window.__pc.iceConnectionState === "completed");
    await callee.waitForFunction(() => window.__pc.iceConnectionState === "connected" || window.__pc.iceConnectionState === "completed");

    const candidateTypes = await caller.evaluate(() =>
      [...window.__pc.getSenders(), ...window.__pc.getReceivers()]
        .flatMap(() => [])
        .concat(window.__pc.__candidateTypes || [])
    );
    expect(candidateTypes).toBeDefined();

    await caller.evaluate(() => window.__dc.send("stargram-turn-e2e"));
    await callee.waitForFunction(() => window.__messages.includes("stargram-turn-e2e"));

    await caller.evaluate(() => {
      window.__pc.setConfiguration({
        iceServers: [{ urls: "turn:127.0.0.1:3479", username: "bad", credential: "bad" }],
        iceTransportPolicy: "relay",
      });
      window.__pc.restartIce();
    });
    await caller.evaluate(() => window.__pc.createOffer({ iceRestart: true }).then(async (offer) => {
      await window.__pc.setLocalDescription(offer);
    }));
    await caller.waitForFunction(() => ["disconnected", "failed"].includes(window.__pc.iceConnectionState), { timeout: 15_000 });

    await caller.evaluate((config) => {
      window.__pc.setConfiguration(config);
      window.__pc.restartIce();
    }, goodConfig);
    await callee.close();
    const recovered = await context.newPage();
    await createPeer(recovered, goodConfig, false);
    await negotiate(caller, recovered);
    await caller.waitForFunction(() => ["connected", "completed"].includes(window.__pc.iceConnectionState), { timeout: 20_000 });

    await caller.evaluate(() => window.__dc.send("stargram-reconnected"));
    await recovered.waitForFunction(() => window.__messages.includes("stargram-reconnected"));
  } finally {
    await context.close();
  }
});
