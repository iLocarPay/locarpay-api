export function getStorage() { return { bucket: () => ({ file: () => ({ save: async () => {}, getSignedUrl: async () => ['https://example.test/x'], makePublic: async () => {} }) }) }; }
