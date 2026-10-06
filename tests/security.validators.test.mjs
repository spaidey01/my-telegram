import test from "node:test";import assert from "node:assert/strict";
const oid=/^[a-f\\d]{24}$/i;
const validateRoomId=id=>typeof id==="string"&&oid.test(id);
const validatePayload=(v,max=100)=>{try{return v!=null&&JSON.stringify(v).length<=max}catch{return false}};
test("room id rejects malformed values",()=>{assert.equal(validateRoomId("abc"),false);assert.equal(validateRoomId("507f1f77bcf86cd799439011"),true)});
test("payload limits",()=>{assert.equal(validatePayload({x:"a".repeat(200)},100),false);assert.equal(validatePayload({x:"ok"},100),true)});
