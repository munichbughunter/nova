import { colors } from '@cliffy/ansi/colors';
import { snapshotTest } from '@cliffy/testing';

// Mock data for code review
const mockFileContents = `
import { useState, useEffect } from 'react';

function UserProfile({ userId }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchUserData() {
      try {
        setLoading(true);
        const response = await fetch(\`/api/users/\${userId}\`);
        if (!response.ok) {
          throw new Error('Failed to fetch user data');
        }
        const data = await response.json();
        setUser(data);
        setError(null);
      } catch (err) {
        setError(err.message);
        setUser(null);
      } finally {
        setLoading(false);
      }
    }

    fetchUserData();
  }, [userId]);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;
  
  return (
    <div className="user-profile">
      <h2>{user.name}</h2>
      <p>Email: {user.email}</p>
      <p>Role: {user.role}</p>
    </div>
  );
}

export default UserProfile;
`;

// Mock merge request data
const mockMergeRequest = {
  iid: 123,
  title: 'Add user profile component',
  description: 'This PR adds a new UserProfile component that fetches and displays user data',
  state: 'opened',
  author: {
    name: 'Jane Doe',
    username: 'jane.doe',
  },
  web_url: 'https://gitlab.com/example-group/example-project/-/merge_requests/123',
  source_branch: 'feature/user-profile',
  target_branch: 'main',
  changes: [
    {
      old_path: null,
      new_path: 'src/components/UserProfile.jsx',
      diff: mockFileContents,
    },
  ],
};

// Mock code review feedback
const mockReviewFeedback = [
  {
    file: 'src/components/UserProfile.jsx',
    line: 15,
    message: 'Consider adding a more specific error message that includes the HTTP status code',
  },
  {
    file: 'src/components/UserProfile.jsx',
    line: 26,
    message: 'Add null checking before accessing user properties to prevent runtime errors',
  },
  {
    file: 'src/components/UserProfile.jsx',
    line: 1,
    message: 'Good practice: Destructuring React imports',
  },
];

// Test agent help command
await snapshotTest({
  name: 'Agent Help Command',
  meta: import.meta,
  colors: true,
  // deno-lint-ignore require-await
  async fn() {
    console.log(colors.blue('\nAI Agents Help\n'));
    console.log('Available Agents:');
    console.log(`  nova agent eng        - Software Engineer`);
    console.log('  nova agent help        - Show this help message\n');
  },
});

// Test engineering agent help command
await snapshotTest({
  name: 'Engineering Agent Help Command',
  meta: import.meta,
  colors: true,
  // deno-lint-ignore require-await
  async fn() {
    console.log(colors.blue('\nSoftware Engineer Agent\n'));
    console.log('Available Commands:');
    console.log('  nova agent eng review       - Review code changes in a file or directory');
    console.log('  nova agent eng review-mr    - Review changes in a merge request');
    console.log('  nova agent eng documentor   - Generate and manage documentation (coming soon)');
    console.log(
      '  nova agent eng architect    - Architecture analysis and suggestions (coming soon)',
    );
    console.log('  nova agent eng tester       - Test case generation and analysis (coming soon)');
    console.log('');
    console.log('Examples:');
    console.log('  nova agent eng review --path src/file.ts');
    console.log('  nova agent eng review-mr --project group/project --mr 123');
    console.log('');
  },
});

// Test code review command output
await snapshotTest({
  name: 'Agent Code Review Command',
  meta: import.meta,
  colors: true,
  // deno-lint-ignore require-await
  async fn() {
    console.log(colors.blue('\nCode Review for src/components/UserProfile.jsx\n'));

    console.log(colors.bold('Summary:'));
    console.log(
      'This file defines a React functional component named UserProfile that fetches and displays user data.',
    );
    console.log(
      'The component handles loading states, error states, and successful data fetching appropriately.',
    );
    console.log('');

    console.log(colors.bold('Strengths:'));
    console.log('✓ Clean implementation of the useState and useEffect hooks');
    console.log('✓ Proper handling of loading and error states');
    console.log('✓ Good separation of concerns between data fetching and rendering');
    console.log('');

    console.log(colors.bold('Areas for Improvement:'));

    mockReviewFeedback.forEach((feedback, index) => {
      console.log(`${index + 1}. ${colors.yellow(`Line ${feedback.line}:`)} ${feedback.message}`);
    });

    console.log('');
    console.log(colors.bold('Suggestions:'));
    console.log('1. Add PropTypes for better type checking');
    console.log('2. Consider adding a retry mechanism for failed requests');
    console.log('3. Extract the fetch logic to a custom hook for reusability');
    console.log('');
  },
});

// Test merge request review command output
await snapshotTest({
  name: 'Agent Merge Request Review Command',
  meta: import.meta,
  colors: true,
  // deno-lint-ignore require-await
  async fn() {
    console.log(
      colors.blue(`\nMerge Request Review: #${mockMergeRequest.iid} - ${mockMergeRequest.title}\n`),
    );

    console.log(colors.bold('MR Details:'));
    console.log(`Author: ${mockMergeRequest.author.name} (${mockMergeRequest.author.username})`);
    console.log(`Source: ${mockMergeRequest.source_branch} → ${mockMergeRequest.target_branch}`);
    console.log(`Description: ${mockMergeRequest.description}`);
    console.log('');

    console.log(colors.bold('Files Changed:'));
    mockMergeRequest.changes.forEach((change) => {
      console.log(`${change.old_path ? 'Modified' : 'Added'}: ${change.new_path}`);
    });
    console.log('');

    console.log(colors.bold('Review Summary:'));
    console.log(
      'The merge request adds a new user profile component with appropriate loading and error states.',
    );
    console.log(
      'The implementation follows React best practices but could be improved with better error handling and null checking.',
    );
    console.log('');

    console.log(colors.bold('Feedback:'));
    mockReviewFeedback.forEach((feedback, index) => {
      console.log(
        `${index + 1}. ${
          colors.yellow(feedback.file)
        } (Line ${feedback.line}): ${feedback.message}`,
      );
    });

    console.log('');
    console.log(colors.bold('Recommendation:'));
    console.log(colors.green('✓ Approve with comments'));
    console.log('');
  },
});

// Test interactive chat mode
await snapshotTest({
  name: 'Agent Interactive Chat Mode',
  meta: import.meta,
  colors: true,
  // deno-lint-ignore require-await
  async fn() {
    console.log(colors.blue('\nInteractive Chat with Engineering Agent\n'));

    console.log(
      colors.gray(
        'Starting chat with AI Engineer. You can ask questions about the code or request explanations.',
      ),
    );
    console.log(colors.gray('Type "exit" or "quit" to end the session.\n'));

    console.log(colors.green('AI Engineer:'));
    console.log("I've reviewed the merge request for adding the UserProfile component.");
    console.log("Overall, it's a solid implementation that follows React best practices.");
    console.log(
      'What specific aspects would you like me to explain or suggest improvements for?\n',
    );

    console.log(colors.yellow('You:'));
    console.log('Can you explain how the error handling could be improved?\n');

    console.log(colors.green('AI Engineer:'));
    console.log('The current error handling could be improved in several ways:');
    console.log('');
    console.log('1. Include HTTP status code in the error message:');
    console.log('```js');
    console.log('if (!response.ok) {');
    console.log(
      '  throw new Error(`Failed to fetch user data: ${response.status} ${response.statusText}`);',
    );
    console.log('}');
    console.log('```');
    console.log('');
    console.log('2. Add null checking before rendering user properties:');
    console.log('```js');
    console.log('return (');
    console.log('  <div className="user-profile">');
    console.log('    <h2>{user?.name || "Unknown User"}</h2>');
    console.log('    <p>Email: {user?.email || "N/A"}</p>');
    console.log('    <p>Role: {user?.role || "N/A"}</p>');
    console.log('  </div>');
    console.log(');');
    console.log('```');
    console.log('');
    console.log('3. Consider implementing a retry mechanism for transient network issues:');
    console.log('```js');
    console.log('const [retries, setRetries] = useState(0);');
    console.log('const MAX_RETRIES = 3;');
    console.log('');
    console.log('// In your fetchUserData function:');
    console.log('catch (err) {');
    console.log('  if (retries < MAX_RETRIES) {');
    console.log('    setRetries(retries + 1);');
    console.log('    // Retry after a delay');
    console.log('    setTimeout(() => fetchUserData(), 1000 * (retries + 1));');
    console.log('    return;');
    console.log('  }');
    console.log('  setError(err.message);');
    console.log('  setUser(null);');
    console.log('}');
    console.log('```\n');

    console.log(colors.yellow('You:'));
    console.log("Thanks, that's helpful. What about performance considerations?\n");

    console.log(colors.green('AI Engineer:'));
    console.log('For performance optimization, consider these improvements:');
    console.log('');
    console.log('1. Add a caching mechanism to avoid refetching the same user data:');
    console.log('```js');
    console.log('// In a separate hook or context:');
    console.log('const userCache = {};');
    console.log('');
    console.log('// In your component:');
    console.log('useEffect(() => {');
    console.log('  async function fetchUserData() {');
    console.log('    // Check cache first');
    console.log('    if (userCache[userId]) {');
    console.log('      setUser(userCache[userId]);');
    console.log('      setLoading(false);');
    console.log('      return;');
    console.log('    }');
    console.log('    ');
    console.log('    // Fetch and cache');
    console.log('    try {');
    console.log('      // ... fetch logic');
    console.log('      userCache[userId] = data; // Cache the result');
    console.log('    } catch (err) {');
    console.log('      // ... error handling');
    console.log('    }');
    console.log('  }');
    console.log('  fetchUserData();');
    console.log('}, [userId]);');
    console.log('```');
    console.log('');
    console.log('2. Use React.memo to prevent unnecessary re-renders:');
    console.log('```js');
    console.log('export default React.memo(UserProfile);');
    console.log('```');
    console.log('');
    console.log('3. Consider implementing a stale-while-revalidate pattern:');
    console.log(
      '   This would show cached data immediately while fetching fresh data in the background.',
    );
    console.log('');
    console.log('4. Add a debounce if userId changes frequently to prevent API hammering.\n');
  },
});
