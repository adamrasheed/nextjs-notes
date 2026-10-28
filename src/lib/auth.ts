export const DEMO_USER_ID = "00000000-0000-4000-8000-000000000001";

export async function getCurrentUserId(): Promise<string> {
  // shortcut: single demo user, replace with Auth.js/Clerk session lookup
  return DEMO_USER_ID;
}
