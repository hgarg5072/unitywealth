# Security Specification: UnityWealth

## 1. Data Invariants
- A User must have a valid record before participating in a household.
- A Household must have at least one member.
- A Holding MUST be associated with a valid householdId.
- Access to a Holding is strictly derived from membership in the associated Household.
- An Invite can only be accepted by the person matching `toEmail`.

## 2. The "Dirty Dozen" Payloads
1. **Identity Spoofing**: User A tries to create a User record for User B's UID.
2. **Resource Poisoning**: User tries to create a Holding with a 1MB string in the `ticker` field.
3. **Privilege Escalation**: User tries to update a Household's `members` list to include themselves without an invite.
4. **Orphaned Write**: Creating a Holding for a non-existent `householdId`.
5. **State Shortcutting**: Updating an Invite status directly from `pending` to `accepted` without following the join flow logic (though rules can't enforce logic flow, they can restrict who can write).
6. **Data Scraping**: Attempting to list all `holdings` without filtering by `householdId`.
7. **PII Leak**: Unauthorized user trying to read another user's email via the `/users` collection.
8. **Shadow Field Injection**: Adding an `isAdmin: true` field to a User document.
9. **Negative Quantity**: Setting a holding's `quantity` to -100.
10. **Timestamp Spoofing**: Setting `syncedAt` to a future date manually.
11. **Foreign Key Attack**: Setting `userId` in a holding to someone else's ID.
12. **Household Hijacking**: Renaming a household you are not a member of.

## 3. Test Runner (Mock)
A `firestore.rules.test.ts` would verify these scenarios by checking `PERMISSION_DENIED`.
