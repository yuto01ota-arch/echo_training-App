import { AUTH } from "../../src/config.js";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";

const file = new URL("../.dev.vars", import.meta.url);
try {
  // Base64url encodes three random bytes as four characters (without padding).
  const password = randomBytes(Math.max(
    AUTH.generatedPasswordBytes, Math.ceil(AUTH.minPasswordLength * 3 / 4),
  )).toString("base64url").slice(0, AUTH.maxPasswordLength);
  const secret = randomBytes(Math.max(
    AUTH.generatedSecretBytes, Math.ceil(AUTH.minSessionSecretLength * 3 / 4),
  )).toString("base64url");
  await writeFile(
    file,
    `DEVELOPER_PASSWORD="${password}"\nSESSION_SECRET="${secret}"\n`,
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    "developer/.dev.vars にローカル用パスワードを作成しました。ファイルを開いて確認してください。",
  );
} catch (error) {
  if (error.code === "EEXIST")
    console.log("既存の developer/.dev.vars を保持しました。");
  else throw error;
}
