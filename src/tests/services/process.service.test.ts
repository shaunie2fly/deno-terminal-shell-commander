import {
  assertEquals,
  assertExists,
  assertRejects,
} from "@std/assert";
import { processService } from "../../services/process.service.ts";
import { ServiceConfig } from "../../services.ts";

Deno.test("ProcessService", async (t) => {
  await t.step("initialization", async () => {
    const config = processService.getConfig();
    assertExists(config);
    assertEquals(config.name, "process");
    assertExists(config.version);
    assertExists(config.commands);
  });

  await t.step("commands", () => {
    const config = processService.getConfig();
    const commands = new Set(config.commands.map(cmd => cmd.name));
    
    // Verify required commands exist
    assertEquals(commands.has("ps"), true);
    assertEquals(commands.has("run"), true);
    assertEquals(commands.has("kill"), true);
    assertEquals(commands.has("bg"), true);
  });

  await t.step("health check", async () => {
    const config = processService.getConfig();
    assertExists(config.healthCheck);
    const healthy = await config.healthCheck();
    assertEquals(healthy, true);
  });
});