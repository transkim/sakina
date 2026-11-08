// Where Zakat and sadaqah given through Sakina go. Filled in by the app owner once a payment account is set up.
// Each link is a hosted checkout page from the payment provider (the provider collects the money; Sakina never sees card or PIN).
window.SakinaGiving = {
  enabled: false,
  org: '',            // registered name of the organisation that receives and distributes the funds
  about: '',          // one or two sentences: who you help and how
  contact: '',        // phone or email for questions and receipts
  currency: 'UGX',
  links: {
    mtn: '',          // MTN Mobile Money checkout link
    airtel: '',       // Airtel Money checkout link
    card: '',         // Visa / Mastercard checkout link
  },
  report: '',         // optional link to a page showing what was collected and given out
};
