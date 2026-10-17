// Diagnostic messages deliberately omit raw server errors and connection values.
export function databaseErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  switch (code) {
    case '28P01':
      return 'Database authentication failed. Check the database service username/password in .env.';
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
      return 'Database certificate is not trusted. Check the CA file selected by sslrootcert in DATABASE_URL.';
    case 'CERT_HAS_EXPIRED':
      return 'Database certificate has expired. Update the service certificate or trusted CA bundle.';
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
      return 'Database certificate does not match the configured hostname. Recheck the service connection details.';
    case 'ENOENT':
      return 'A database certificate file is missing. Run from apps/server and check the sslrootcert path.';
    case 'ENOTFOUND':
      return 'Database hostname could not be resolved. Check the URL hostname and network access.';
    case 'ECONNREFUSED':
    case 'ETIMEDOUT':
      return 'Database could not be reached. Check the service status, host, port, and network access.';
    case '3D000':
      return 'The configured database does not exist. Check the database name in DATABASE_URL.';
    case '42501':
      return 'The database user does not have permission for this operation.';
    default:
      return 'Database operation failed. Check service availability and local connection settings.';
  }
}
