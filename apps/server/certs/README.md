# Tiger Cloud CA pin

`tiger-ca.pem` is a public CA certificate, not a password or private key. It is
used only by this backend. Tiger Cloud hostnames ending in
`.tsdb.cloud.timescale.com` automatically select it when the URL has no explicit
`sslrootcert`. It is not installed into Windows or the global Node trust store.

- Subject: `O=Timescale Inc, CN=ca.timescale.com`
- SHA-256 fingerprint: `06:5A:75:0D:0D:64:F6:2D:AC:DC:97:9E:3B:83:D2:11:95:40:71:EA:59:B8:F3:40:7C:4E:87:CA:68:34:64:57`
- Validity: January 23, 2025 through October 20, 2027 (GMT).

Initial trust was established by retrieving the configured Tiger Cloud service's
public PostgreSQL TLS chain. The bootstrap sent no database login credentials;
it checked certificate dates, chain signatures, hostname, and the expected CA
subject. This is trust on first use: the CA's authenticity was not independently
verified through a separate vendor-authenticated channel. Keep the fingerprint
for review and compare it with a certificate supplied by Tiger Data when available.

Normal database connections require `verify-full`: the pinned CA must validate
the server certificate and its hostname. The pin is not refreshed automatically.
If the service rotates its CA, confirm the replacement through a trusted vendor
channel before replacing this file. A different service may use a different CA.
