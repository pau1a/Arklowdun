import test from "node:test";
import assert from "node:assert/strict";

import { getContract } from "../../src/lib/ipc/port";
import { UnknownIpcCommandError, UNKNOWN_IPC_ERROR_CODE } from "../../src/lib/ipc/errors";

const UNKNOWN_COMMAND = "totally_unknown_command";

test("unknown IPC command throws descriptive error", () => {
  assert.throws(
    () => getContract(UNKNOWN_COMMAND as never),
    (error: unknown) => {
      assert.ok(error instanceof UnknownIpcCommandError, "uses UnknownIpcCommandError");
      assert.equal(error.code, UNKNOWN_IPC_ERROR_CODE);
      assert.ok(error.message.includes(UNKNOWN_COMMAND));
      assert.ok(error.message.includes("Known commands"));
      assert.ok(error.knownCommands.length > 0);
      return true;
    },
  );
});
