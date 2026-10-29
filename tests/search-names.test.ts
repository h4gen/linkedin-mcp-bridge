import { it, expect } from "vitest";
import { conversationSearchText } from "../src/core/api.js";
it("searches LinkedIn attributed participant names without matching metadata", () => {
  const text = conversationSearchText({
    conversationParticipants: [
      {
        participantType: {
          member: {
            firstName: {
              text: "Parth",
              attributes: [{ tracking: "secret-target" }],
            },
            lastName: { text: "Patel" },
          },
        },
      },
    ],
    title: { text: "Conversation" },
    entityUrn: "urn:li:secret-target",
  });
  expect(text).toContain("Parth Patel");
  expect(text).toContain("Conversation");
  expect(text).not.toContain("secret-target");
});
