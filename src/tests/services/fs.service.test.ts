import {
  assertEquals,
  assertExists,
  assertRejects,
} from "@std/assert";
import { fileSystemService } from "../../services/fs.service.ts";
import { ServiceConfig } from "../../services.ts";

Deno.test("FileSystemService", async (t) => {
  await t.step("initialization", async () => {
    const config = fileSystemService.getConfig();
    assertExists(config);
    assertEquals(config.name, "fs");
    assertExists(config.version);
    assertExists(config.commands);
  });

  await t.step("commands", () => {
    const config = fileSystemService.getConfig();
    const commands = new Set(config.commands.map(cmd => cmd.name));
    
    // Verify required commands exist
    assertEquals(commands.has("ls"), true);
    assertEquals(commands.has("cd"), true);
    assertEquals(commands.has("cat"), true);
    assertEquals(commands.has("cp"), true);
    assertEquals(commands.has("mv"), true);
    assertEquals(commands.has("rm"), true);
    assertEquals(commands.has("mkdir"), true);
    assertEquals(commands.has("pwd"), true);
  });
});