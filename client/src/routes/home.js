/** Where each role lands after signing in. */
export const homeFor = (role) => ({ customer: '/tickets', agent: '/queue', manager: '/manager' })[role];
