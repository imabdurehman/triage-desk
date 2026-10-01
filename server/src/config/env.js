// The only file that reads process.env. Everything else imports `env` from here.

if (!isTest) {
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    // Fail at boot, loudly, rather than at the first request.

  }
}

export const env = Object.freeze({

});
