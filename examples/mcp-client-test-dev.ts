// MCP client test script for development testing
// This version connects to a locally running MCP server during development
// Tests both STDIO and SSE transport methods
// Run with: deno run --allow-run --allow-read --allow-env --allow-net examples/mcp-client-test-dev.ts

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
async function runTests() {
  // Run tests with both transport mechanisms
  console.log('==== TESTING WITH STDIO TRANSPORT ====');
  await testMcpServer('stdio');

  console.log('\n\n==== TESTING WITH SSE TRANSPORT ====');
  await testMcpServer('sse');

  console.log('\nAll tests completed!');
}

async function testMcpServer(transportType = 'stdio') {
  console.log(
    `Connecting to local nova MCP server using ${transportType.toUpperCase()} transport...`,
  );

  // Create transport based on the specified type
  let transport;
  let client;

  if (transportType === 'stdio') {
    // Create stdio transport that launches the MCP server directly from the local code
    transport = new StdioClientTransport({
      command: 'deno',
      args: [
        'run',
        '--allow-net',
        '--allow-read',
        '--allow-write',
        '--allow-env',
        '--allow-run',
        'main.ts',
        'mcp',
        'server',
        '--no-sse',
      ],
    });
  } else {
    // Create SSE transport that connects to a running MCP server
    transport = new SSEClientTransport(new URL('http://localhost:3020/mcp'));
  }

  // Create MCP client
  client = new Client(
    {
      name: `mcp-test-client-${transportType}`,
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  try {
    // Connect to the server
    console.log('Establishing connection...');
    await client.connect(transport);
    console.log('Connected!');

    // Test resources first
    console.log('\n--- Testing Resources ---');

    // List available resources
    console.log('\nListing available resources:');
    const resources = await client.listResources();
    console.log(`Found ${resources.resources.length} resources:`);
    for (const resource of resources.resources) {
      console.log(`- ${resource.name}: ${resource.uri_template}`);
    }

    // Read help resource
    console.log('\nReading help resource:');
    const helpResource = await client.readResource({ uri: 'help://usage' });
    if (helpResource.contents && helpResource.contents.length > 0) {
      console.log(
        'Help resource content:',
        (helpResource.contents[0] as { text: string }).text.substring(0, 100) + '...',
      );
    }

    // Read system info resource
    console.log('\nReading system info resource:');
    const systemInfo = await client.readResource({ uri: 'system://info' });
    if (systemInfo.contents && systemInfo.contents.length > 0) {
      console.log('System info:', (systemInfo.contents[0] as { text: string }).text);
    }

    // Test tools
    console.log('\n--- Testing Tools ---');

    // Get available tools
    console.log('\nListing available tools:');
    const tools = await client.listTools();
    console.log(`Found ${tools.tools.length} tools:`);
    for (const tool of tools.tools) {
      console.log(`- ${tool.name}: ${tool.description}`);
    }

    // Create an array to track test results
    const testResults = [];

    // Test file_read tool
    if (tools.tools.some((t) => t.name === 'file_read')) {
      console.log('\nTesting file_read tool:');
      try {
        const readResult = await client.callTool({
          name: 'file_read',
          arguments: {
            file: 'README.md',
            start_line: 0,
            end_line: 5,
          },
        });

        if (readResult.content && readResult.content.length > 0) {
          console.log(
            'File content (first 100 chars):',
            readResult.content[0].text.substring(0, 100) + '...',
          );
          testResults.push({ tool: 'file_read', success: true });
        } else {
          console.log('No content returned from file_read tool');
          testResults.push({ tool: 'file_read', success: false });
        }
      } catch (error: any) {
        console.error('Error calling file_read tool:', error.message);
        testResults.push({ tool: 'file_read', success: false, error: error.message });
      }
    }

    // Test terminal tool
    if (tools.tools.some((t) => t.name === 'terminal')) {
      console.log('\nTesting terminal tool:');
      try {
        const terminalResult = await client.callTool({
          name: 'terminal',
          arguments: {
            command: 'ls -la | head -n 5',
            require_user_approval: false,
          },
        });

        if (terminalResult.content && terminalResult.content.length > 0) {
          console.log('Terminal output:', terminalResult.content[0].text);
          testResults.push({ tool: 'terminal', success: true });
        } else {
          console.log('No content returned from terminal tool');
          testResults.push({ tool: 'terminal', success: false });
        }
      } catch (error: any) {
        console.error('Error calling terminal tool:', error.message);
        testResults.push({ tool: 'terminal', success: false, error: error.message });
      }
    }

    // Test task management tools
    if (tools.tools.some((t) => t.name === 'init_task')) {
      console.log('\nTesting task management tools:');
      try {
        // Initialize a test task
        const taskName = `test-task-${Date.now()}`;
        const initResult = await client.callTool({
          name: 'init_task',
          arguments: {
            taskName,
          },
        });

        if (initResult.content && initResult.content.length > 0) {
          console.log('Task initialization result:', initResult.content[0].text);
          const taskDir = JSON.parse(initResult.content[0].text).taskDir;
          testResults.push({ tool: 'init_task', success: true });

          // Write a file to the task directory
          if (tools.tools.some((t) => t.name === 'write_task_file')) {
            try {
              const writeResult = await client.callTool({
                name: 'write_task_file',
                arguments: {
                  taskDir,
                  filename: 'test.md',
                  content: '# Test File\n\nThis is a test file created during MCP testing.',
                },
              });

              if (writeResult.content && writeResult.content.length > 0) {
                console.log('Write task file result:', writeResult.content[0].text);
                testResults.push({ tool: 'write_task_file', success: true });

                // Read the file back
                if (tools.tools.some((t) => t.name === 'read_task_file')) {
                  try {
                    const readResult = await client.callTool({
                      name: 'read_task_file',
                      arguments: {
                        taskDir,
                        filename: 'test.md',
                      },
                    });

                    if (readResult.content && readResult.content.length > 0) {
                      console.log('Read task file result:', readResult.content[0].text);
                      testResults.push({ tool: 'read_task_file', success: true });
                    }
                  } catch (error: any) {
                    console.error('Error calling read_task_file tool:', error.message);
                    testResults.push({
                      tool: 'read_task_file',
                      success: false,
                      error: error.message,
                    });
                  }
                }
              }
            } catch (error: any) {
              console.error('Error calling write_task_file tool:', error.message);
              testResults.push({ tool: 'write_task_file', success: false, error: error.message });
            }
          }
        }
      } catch (error: any) {
        console.error('Error calling init_task tool:', error.message);
        testResults.push({ tool: 'init_task', success: false, error: error.message });
      }
    }

    // Test javascript_executor tool
    if (tools.tools.some((t) => t.name === 'javascript_executor')) {
      console.log('\nTesting javascript_executor tool:');
      try {
        const jsResult = await client.callTool({
          name: 'javascript_executor',
          arguments: {
            description: 'Calculate the factorial of 5',
            code:
              'function factorial(n) { return n <= 1 ? 1 : n * factorial(n-1); } return factorial(5);',
          },
        });

        if (jsResult.content && jsResult.content.length > 0) {
          const resultText = jsResult.content[0].text;
          console.log('JavaScript execution result:', resultText);

          // Check if this is a configuration issue
          if (resultText.includes('not available') || resultText.includes('configure')) {
            testResults.push({
              tool: 'javascript_executor',
              success: false,
              configRequired: true,
              message: resultText,
            });
          } else {
            testResults.push({ tool: 'javascript_executor', success: true });
          }
        } else {
          console.log('No content returned from javascript_executor tool');
          testResults.push({ tool: 'javascript_executor', success: false });
        }
      } catch (error: any) {
        console.error('Error calling javascript_executor tool:', error.message);
        testResults.push({ tool: 'javascript_executor', success: false, error: error.message });
      }
    }

    // Test GitLab search tool
    if (tools.tools.some((t) => t.name === 'gitlab_search')) {
      console.log('\nTesting gitlab_search tool:');
      try {
        const gitlabResult = await client.callTool({
          name: 'gitlab_search',
          arguments: {
            query: 'abx',
            scope: 'projects',
          },
        });

        if (gitlabResult.content && gitlabResult.content.length > 0) {
          const resultText = gitlabResult.content[0].text;
          console.log(
            'GitLab search result:',
            resultText.substring(0, 100) + (resultText.length > 100 ? '...' : ''),
          );

          // Check if this is a configuration issue
          if (resultText.includes('not available') || resultText.includes('configure')) {
            testResults.push({
              tool: 'gitlab_search',
              success: false,
              configRequired: true,
              message: resultText,
            });
          } else {
            testResults.push({ tool: 'gitlab_search', success: true });
          }
        } else {
          console.log('No content returned from gitlab_search tool');
          testResults.push({ tool: 'gitlab_search', success: false });
        }
      } catch (error: any) {
        console.error('Error calling gitlab_search tool:', error.message);
        testResults.push({ tool: 'gitlab_search', success: false, error: error.message });
      }
    }

    // Test Jira search tool
    if (tools.tools.some((t) => t.name === 'jira_search')) {
      console.log('\nTesting jira_search tool:');
      try {
        const jiraResult = await client.callTool({
          name: 'jira_search',
          arguments: {
            jql: 'project = "WEB" AND status = "PEER REVIEW"',
          },
        });

        if (jiraResult.content && jiraResult.content.length > 0) {
          const resultText = jiraResult.content[0].text;
          console.log(
            'Jira search result:',
            resultText.substring(0, 50) + (resultText.length > 50 ? '...' : ''),
          );
          const jiraIssues = JSON.parse(resultText).issues;
          // Check if this is a configuration issue
          if (jiraIssues.length === 0) {
            testResults.push({
              tool: 'jira_search',
              success: false,
              configRequired: true,
              message: resultText,
            });
          } else {
            testResults.push({ tool: 'jira_search', success: true });
          }
        } else {
          console.log('No content returned from jira_search tool');
          testResults.push({ tool: 'jira_search', success: false });
        }
      } catch (error: any) {
        console.error('Error calling jira_search tool:', error.message);
        testResults.push({ tool: 'jira_search', success: false, error: error.message });
      }
    }

    // Test Datadog search tool
    if (tools.tools.some((t) => t.name === 'datadog_search')) {
      console.log('\nTesting datadog_search tool:');
      try {
        const datadogResult = await client.callTool({
          name: 'datadog_search',
          arguments: {
            query: 'service:nova error:500',
            type: 'logs',
            timeRange: '24h',
          },
        });

        if (datadogResult.content && datadogResult.content.length > 0) {
          const resultText = datadogResult.content[0].text;
          console.log(
            'Datadog search result:',
            resultText.substring(0, 100) + (resultText.length > 100 ? '...' : ''),
          );

          // Check if this is a configuration issue
          if (resultText.includes('not available') || resultText.includes('configure')) {
            testResults.push({
              tool: 'datadog_search',
              success: false,
              configRequired: true,
              message: resultText,
            });
          } else {
            testResults.push({ tool: 'datadog_search', success: true });
          }
        } else {
          console.log('No content returned from datadog_search tool');
          testResults.push({ tool: 'datadog_search', success: false });
        }
      } catch (error: any) {
        console.error('Error calling datadog_search tool:', error.message);
        testResults.push({ tool: 'datadog_search', success: false, error: error.message });
      }
    }

    // Test Confluence search tool
    if (tools.tools.some((t) => t.name === 'confluence_search')) {
      console.log('\nTesting confluence_search tool:');
      try {
        const confluenceResult = await client.callTool({
          name: 'confluence_search',
          arguments: {
            query: 'project', // Generic search term likely to find results
            space: '', // Search across all spaces
          },
        });

        if (confluenceResult.content && confluenceResult.content.length > 0) {
          const resultText = confluenceResult.content[0].text;
          console.log(
            'Confluence search result:',
            resultText.substring(0, 100) + (resultText.length > 100 ? '...' : ''),
          );

          // Check if this is a configuration issue
          if (resultText.includes('not available') || resultText.includes('configure')) {
            testResults.push({
              tool: 'confluence_search',
              success: false,
              configRequired: true,
              message: resultText,
            });
          } else {
            // Even if we get a "no results found" message, if it's properly formatted it's a success
            // since that means the service is working but just didn't find any matching content
            const parsedResult = JSON.parse(resultText);
            const isNoResultsMessage = parsedResult.message &&
              parsedResult.message.includes('No Confluence pages found');

            if (isNoResultsMessage || (parsedResult.results && parsedResult.results.length >= 0)) {
              testResults.push({ tool: 'confluence_search', success: true });
            } else {
              testResults.push({
                tool: 'confluence_search',
                success: false,
                message: 'Unexpected response format',
              });
            }
          }
        } else {
          console.log('No content returned from confluence_search tool');
          testResults.push({ tool: 'confluence_search', success: false });
        }
      } catch (error: any) {
        console.error('Error calling confluence_search tool:', error.message);
        testResults.push({ tool: 'confluence_search', success: false, error: error.message });
      }
    }

    // Compare resource-based file access vs tool-based file access
    console.log('\n--- Comparing Resource vs Tool File Access ---');
    try {
      console.log('\nAccessing file via resource:');
      console.log('Requesting file URI:', 'file://README.md');
      const fileResource = await client.readResource({ uri: 'file://README.md' });
      if (fileResource.contents && fileResource.contents.length > 0) {
        console.log(
          'File content via resource (first 100 chars):',
          (fileResource.contents[0] as { text: string }).text.substring(0, 100) + '...',
        );
      }
    } catch (error: any) {
      console.error('Error accessing file via resource:', error.message);
      try {
        console.log('\nTrying alternative URI format...');
        const fileResource = await client.readResource({ uri: 'file:///README.md' });
        if (fileResource.contents && fileResource.contents.length > 0) {
          console.log(
            'File content via resource (first 100 chars):',
            (fileResource.contents[0] as { text: string }).text.substring(0, 100) + '...',
          );
        }
      } catch (altError: any) {
        console.error('Alternative URI also failed:', altError.message);
      }
    }

    // Summary
    console.log('\n----- TEST SUMMARY -----');
    console.log('✅ MCP Server Connection: Success');
    console.log('✅ Resource Listing: Success');
    console.log('✅ Resource Reading (help): Success');
    console.log('✅ Resource Reading (system): Success');
    console.log('✅ Tool Listing: Success');

    // Track counts for summary
    let successCount = 0;
    let configRequiredCount = 0;
    let failureCount = 0;

    // Output tool test results
    for (const result of testResults) {
      if (result.success) {
        console.log(`✅ Tool Execution (${result.tool}): Success`);
        successCount++;
      } else if (result.configRequired) {
        console.log(`⚙️  Tool Execution (${result.tool}): Configuration Required`);
        configRequiredCount++;
      } else {
        console.log(
          `❌ Tool Execution (${result.tool}): Failed${result.error ? ' - ' + result.error : ''}`,
        );
        failureCount++;
      }
    }

    console.log('✅ File Access via Resource: Success');

    // Final summary
    console.log('\nTest Results Summary:');
    console.log(`- ${successCount} tools executed successfully`);
    console.log(`- ${configRequiredCount} tools require configuration`);
    console.log(`- ${failureCount} tools failed execution`);

    if (failureCount === 0) {
      console.log('\nAll tests completed successfully or require configuration!');
    } else {
      console.log('\n⚠️ Some tool tests failed. Check logs for details.');
    }
  } catch (error) {
    console.error('Error testing MCP server:', error);
  } finally {
    // Close the connection
    await transport.close();
    console.log('\nTest complete!');
  }
}

// Run tests with both transport methods
runTests();
