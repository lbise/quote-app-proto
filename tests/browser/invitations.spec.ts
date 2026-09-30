import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import { createUser, signedInContext } from "./admin-support";
import { expect, test } from "./fixtures";

/** Store an invitation directly and return its link token. The link is only in the email, which stays in the server process. */
async function storedInvitation(email: string) {
  const token = randomBytes(32).toString("base64url");
  const database = new pg.Client({ connectionString: process.env.BROWSER_TEST_DATABASE_URL });
  await database.connect();
  try {
    await database.query(
      `insert into invitation (id, email, token_hash, invited_by_email, sent_at, expires_at)
       values ($1, $2, $3, 'browser-admin@example.com', now(), now() + interval '7 days')`,
      [crypto.randomUUID(), email, createHash("sha256").update(token).digest("hex")],
    );
  } finally { await database.end(); }
  return token;
}

test("an Administrator invites someone, resends the invitation and cancels it", async ({ browser }) => {
  const administrator = await createUser("Inviting Administrator", { administrator: true });
  const email = `invitee-${crypto.randomUUID()}@example.com`;
  const context = await signedInContext(browser, administrator.email);
  const page = await context.newPage();
  try {
    await page.goto("/admin");
    await page.getByRole("button", { name: "Invite" }).click();
    const dialog = page.getByRole("dialog", { name: "Invite someone" });
    await dialog.getByLabel("Email").fill(email);

    // The email text starts from the default, which follows the role until it is edited.
    const subject = dialog.getByLabel("Subject");
    const message = dialog.getByLabel("Message");
    await expect(subject).toHaveValue("Invitation à Easy Quote / Your invitation to Easy Quote");
    await expect(message).toHaveValue(/^Vous êtes invité à utiliser Easy Quote\.\n[\s\S]*\{lien\}[\s\S]*\n---\n[\s\S]*You are invited to use Easy Quote\./);
    await expect(message).not.toHaveValue(/Administrators can read/);
    await expect(dialog.getByText("{lien} is replaced by the invitation link. If it is missing, the link is added at the end.")).toBeVisible();
    const role = dialog.getByLabel("Make them an Administrator");
    await role.check();
    await expect(message).toHaveValue(/You are invited to use Easy Quote as an Administrator\./);
    await message.fill("Welcome aboard: {lien}");
    await role.uncheck();
    await expect(message).toHaveValue("Welcome aboard: {lien}");
    await expect(dialog.getByText("Your edited message was kept as it is")).toBeVisible();
    await role.check();
    await dialog.getByRole("button", { name: "Restore the default text" }).click();
    await expect(message).toHaveValue(/You are invited to use Easy Quote as an Administrator\./);
    await expect(dialog.getByText("Your edited message was kept as it is")).toBeHidden();

    await subject.fill("Join Easy Quote");
    await message.fill("Hello,\n\nYour link: {lien}");
    await dialog.getByRole("button", { name: "Send invitation" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("status")).toContainText(`${email} has been emailed a link`);

    const row = page.getByRole("row").filter({ hasText: email });
    await expect(row).toContainText("Invitation pending");
    await expect(row).toContainText("Administrator");
    const record = page.getByRole("region", { name: "Administrator actions" });
    await expect(record).toContainText(`${administrator.email} invited ${email} as an Administrator`);

    // The same email cannot be invited twice.
    await page.getByRole("button", { name: "Invite" }).click();
    await dialog.getByLabel("Email").fill(email);
    await dialog.getByRole("button", { name: "Send invitation" }).click();
    await expect(dialog.getByRole("alert")).toContainText("already has a pending invitation");
    await dialog.getByRole("button", { name: "Cancel" }).click();

    await row.getByRole("button", { name: "Resend" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Resend" }).click();
    await expect(record).toContainText(`${administrator.email} resent the invitation to ${email}`);

    await row.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel invitation" }).click();
    await expect(row).toContainText("Invitation cancelled");
    await expect(record).toContainText(`${administrator.email} cancelled the invitation to ${email}`);
  } finally { await context.close(); }
});

test("an invitee signs up through their link with the email locked, and is told what Administrators can read", async ({ browser }) => {
  const email = `invitee-${crypto.randomUUID()}@example.com`;
  const token = await storedInvitation(email);
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();
  try {
    await page.goto(`/sign-up?invitation=${token}`);
    await expect(page.getByText("You have been invited to Easy Quote.")).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveValue(email);
    await expect(page.getByLabel("Email")).toHaveAttribute("readonly", "");
    await expect(page.getByText("Administrators can read your Quotes and your conversations with the assistant", { exact: false })).toBeVisible();
    await expect(page.getByText("up to 30 days", { exact: false })).toBeVisible();

    await page.getByLabel("Name").fill("Invited Artisan");
    await page.getByLabel("Password (at least 8 characters)").fill("invitee-password");
    await page.getByLabel("Confirm password").fill("invitee-password");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/verify\?email=/);

    // The link is used up.
    await page.goto(`/sign-up?invitation=${token}`);
    await expect(page.getByRole("heading", { name: "This invitation link can no longer be used" })).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveCount(0);
  } finally { await context.close(); }
});
