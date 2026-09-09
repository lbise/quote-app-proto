import { afterEach, describe, expect, it } from "vitest";

import { capturedEmailsForTests, clearCapturedEmails, sendAuthEmail } from "./mail.server";

afterEach(() => {
  clearCapturedEmails();
});

describe("captured auth mail", () => {
  it("captures localized verification messages without sending them", async () => {
    const previous = process.env.EMAIL_DELIVERY;
    delete process.env.EMAIL_DELIVERY;
    try {
      await sendAuthEmail({
        to: "tester@example.com",
        url: "https://example.test/api/auth/verify-email?token=test",
        kind: "verification",
        language: "en",
      });
      expect(capturedEmailsForTests()[0]).toMatchObject({
        to: "tester@example.com",
        subject: "Verify your Easy Quote email",
      });
    } finally {
      if (previous === undefined) delete process.env.EMAIL_DELIVERY;
      else process.env.EMAIL_DELIVERY = previous;
    }
  });
});
