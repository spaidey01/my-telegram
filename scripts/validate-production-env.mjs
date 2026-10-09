import { validateProductionEnv } from "../src/utils/productionConfig.js";

try {
  validateProductionEnv();
  console.log("Production environment validation passed.");
} catch (error) {
  console.error(`Production environment validation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
