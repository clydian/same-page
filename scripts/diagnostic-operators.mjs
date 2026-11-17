// Do not turn a legacy feedback-only grant/revoke into a product-wide change.
throw new Error("Feedback permissions are now part of the product administrator role. Use npm run admin:configure -- grant|revoke --local|--remote USER_ID; this changes access to all product admin functions.");
