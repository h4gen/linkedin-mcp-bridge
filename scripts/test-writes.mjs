// Explicit local acceptance builds only. Never carry test capabilities into a package.
export function testWrites(channel, value = "") {
  if (!value) return [];
  if (channel !== "development")
    throw Error("Test writes require a development build");
  const allowed = new Set([
    "conversation_delete",
    "invitation_send",
    "invitation_respond",
    "invitation_withdraw",
  ]);
  const selected = [...new Set(value.split(",").map((x) => x.trim()))];
  if (selected.some((x) => !allowed.has(x)))
    throw Error("Unsupported acceptance-test capability");
  return selected;
}
