import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStorageContract } from "../../core/test/storage-contract.js";
import { LibsqlStorage } from "../src/index.js";

const dir = mkdtempSync(join(tmpdir(), "ccshare-libsql-"));
let n = 0;
const freshUrl = () => `file:${join(dir, `db-${n++}.sqlite`)}`;

runStorageContract({
  name: "libsql (file:)",
  fresh: async () => new LibsqlStorage(freshUrl()),
  pair: async () => {
    const url = freshUrl();
    return [
      new LibsqlStorage(url, { groupId: "grp-a" }),
      new LibsqlStorage(url, { groupId: "grp-b" }),
    ];
  },
});
