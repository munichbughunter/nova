import { snapshotTest } from '@cliffy/testing';

// Define some mock data for the test
const mockMergeRequest = {
  iid: 123,
  title: 'Fix the bug in login flow',
  description: 'This PR fixes the authentication bug in the login flow',
  state: 'opened',
  created_at: '2023-06-15T10:00:00Z',
  updated_at: '2023-06-15T15:00:00Z',
  author: {
    name: 'John Doe',
    username: 'johndoe',
  },
  changes: [
    {
      old_path: 'src/auth/login.ts',
      new_path: 'src/auth/login.ts',
      diff:
        '@@ -10,7 +10,7 @@\n function authenticate(user, password) {\n-  if (user.password === password) {\n+  if (user.password === password && user.enabled) {\n     return true;\n   }\n   return false;',
      deleted_file: false,
      new_file: false,
      renamed_file: false,
    },
  ],
  web_url: 'https://gitlab.com/example-group/example-project/-/merge_requests/123',
  source_branch: 'feature/fix-login',
  target_branch: 'master',
  reviewers: { nodes: [] },
  approved: false,
  approvedBy: { nodes: [] },
};

// A simplified snapshot test with no external dependencies
await snapshotTest({
  name: 'Merge Request Review Example',
  meta: import.meta,
  colors: true,
  // deno-lint-ignore require-await
  async fn() {
    // Simple log of merge request details for snapshot
    console.log(`Project: example-group/example-project`);
    console.log(`MR #${mockMergeRequest.iid}: ${mockMergeRequest.title}`);
    console.log(`Author: ${mockMergeRequest.author.name} (${mockMergeRequest.author.username})`);
    console.log(`Description: ${mockMergeRequest.description}`);
    console.log(`Source Branch: ${mockMergeRequest.source_branch}`);
    console.log(`Target Branch: ${mockMergeRequest.target_branch}`);

    // Log code changes
    console.log('\nCode Changes:');
    for (const change of mockMergeRequest.changes) {
      console.log(`File: ${change.new_path}`);
      console.log(`Diff: ${change.diff}`);
    }
  },
});
