# Acceptance checks

Use two isolated browser profiles. Never use a single shared identity for two people.

1. Register Alice and Bob; verify duplicate display names allowed, IDs different. Reload and confirm identity persistence.
2. Open Bob /u link as Alice; presence is not exposed. Request contact. Alice cannot accept her own request. Bob accepts. Create direct chat from profile.
3. Send text both directions, reload, disconnect receiver, send messages, reconnect and verify one visible copy. Confirm mailbox deleted only after receiver ACK. Kill sender network and check queued outgoing messages retry after reconnect.
4. Try tampered signatures, repeated nonces, revoked device credentials, nonmember R2 download, self-accepted request. They must fail.
5. Send file/photo/video and voice. Inspect Worker request bytes: only octet-stream ciphertext is uploaded; filename/key only inside envelope. Receive and verify original bytes.
6. Reply/edit/react/remove reaction/forward/pin/delete and search. Local read status appears only after receiver opens chat. Disable read receipts and verify no new read events.
7. Create group from accepted contacts, add/remove members as owner; verify nonowner cannot modify membership. Removed member cannot receive newly sent envelopes or download group R2 files.
8. Audio/video call between browsers: offer/ringing/accept/end/reject, permissions denied, mute, camera on/off, camera replacement, browser-supported screen share/PiP. Test direct and TURN-only networks. Observe browser RTC stats rather than assuming P2P from a label.
9. Pair independent device keys: create invitation on a fresh browser, approve on root device, paste signed response on new browser. Verify new device gets future traffic. Revoke paired device and verify new requests fail/socket closes.
10. Export recovery and restore with correct key. Wrong key fails. History does not magically return. Root recovery must create new distinct device keys; a revoked old device must remain revoked.
11. Mobile 360/390px and desktop 1440px, keyboard, safe area, context menus, sheet scroll and reduced motion. Install PWA, refresh while offline after an online visit, verify shell/history without claiming offline remote communication.
12. Confirm UI contains no fake security/P2P/online claims, no placeholder conversations and no unhandled decorative buttons.
