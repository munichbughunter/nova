# Troubleshooting Copilot MCP

This guide helps you troubleshoot common issues with the GitHub Copilot MCP integration.

## Common Issues and Solutions

### MCP Server Won't Start

**Problem**: The MCP server fails to start with error messages.

**Possible causes and solutions**:

1. **Port conflict**
   - **Symptom**: Error message about port 3020 already in use
   - **Solution**: Kill the process using the port or specify a different port:
     ```bash
     nova mcp server --port 3021
     ```

2. **Missing configuration**
   - **Symptom**: Error messages about missing configuration
   - **Solution**: Run the setup command and ensure your Nova configuration is complete:
     ```bash
     nova setup
     nova mcp setup
     ```

3. **Permission issues**
   - **Symptom**: Permission denied errors
   - **Solution**: Check file and directory permissions:
     ```bash
     chmod -R 755 ~/.nova
     ```

### Copilot Not Using MCP Tools

**Problem**: GitHub Copilot doesn't use the MCP tools even though the server is running.

**Possible causes and solutions**:

1. **Server not running**
   - **Solution**: Make sure the MCP server is running in a separate terminal:
     ```bash
     nova mcp server
     ```

2. **Wrong directory**
   - **Solution**: Ensure you're running the MCP server in the same directory as your project.

3. **Configuration issues**
   - **Solution**: Verify the MCP configuration in your project:
     ```bash
     cat .vscode/mcp.json
     cat .cursor/mcp.json
     ```

4. **Connection issues**
   - **Solution**: Try restarting the MCP server and your editor.

### Service Integration Problems

**Problem**: Copilot can't access services like Jira or GitLab.

**Possible causes and solutions**:

1. **Authentication issues**
   - **Symptom**: "Unauthorized" or "Authentication failed" errors
   - **Solution**: Verify and update your service credentials:
     ```bash
     nova config update
     ```

2. **API access issues**
   - **Symptom**: "Access denied" or "Permission denied" errors
   - **Solution**: Check your API token permissions and scopes.

3. **Network issues**
   - **Symptom**: Timeout or connection errors
   - **Solution**: Check your network connection and firewall settings.

4. **Service configuration**
   - **Symptom**: "Service not configured" errors
   - **Solution**: Ensure the service is properly configured in Nova:
     ```bash
     nova config show
     ```

### Debug Mode

To troubleshoot issues more effectively, you can run the MCP server in debug mode:

```bash
NOVA_DEBUG=true nova mcp server
```

This will show more detailed logs that can help identify the root cause of problems.

## Checking Server Status

To check if the MCP server is running properly:

1. Look for the MCP server process:
   ```bash
   ps aux | grep "nova mcp server"
   ```

2. Check if the SSE endpoint is responding (if using SSE transport):
   ```bash
   curl -v http://localhost:3020/ping
   ```
   You should get a `pong` response if the server is running.

## Debugging Tool Execution

If tools are not working as expected:

1. Run the MCP server with debug logging:
   ```bash
   NOVA_DEBUG=true nova mcp server
   ```

2. Look for specific tool execution logs in the output.

3. Check for error messages or warnings related to the tools you're trying to use.

## Common Error Messages

Here are some common error messages and their solutions:

### "Error connecting to stdio transport"

This usually indicates a problem with the stdio communication channel.

**Solution**: 
- Restart the MCP server
- Ensure no other process is reading from stdin or writing to stdout
- Try using the SSE transport instead:
  ```bash
  nova mcp server --no-stdio --sse
  ```

### "Error: ENOENT: no such file or directory"

This indicates a problem finding a file or directory.

**Solution**:
- Make sure you're running the MCP server in the correct directory
- Check that the file paths in your requests are correct
- Use absolute paths when necessary

### "Service not initialized" or "Service not configured"

This indicates that a required service (like Jira or GitLab) hasn't been configured.

**Solution**:
- Run the setup process to configure the service:
  ```bash
  nova setup
  ```
- Or manually update your configuration:
  ```bash
  nova config update
  ```

### "Tool execution failed"

This generic error happens when a tool fails to execute properly.

**Solution**:
- Check the specific error message in the debug logs
- Verify that all required parameters are provided
- Ensure the service is properly configured and accessible

## Resetting the Configuration

If you suspect configuration issues are causing problems, you can reset your MCP configuration:

1. Remove the MCP configuration files:
   ```bash
   rm -f .vscode/mcp.json .cursor/mcp.json
   ```

2. Set up MCP again:
   ```bash
   nova mcp setup
   ```

## Getting Additional Help

If you're still experiencing issues:

1. Check the [Nova documentation](https://docs.nova.dev) for updates
2. Look for similar issues in the [Nova GitHub repository](https://github.com/yourusername/nova/issues)
3. Submit a detailed bug report with:
   - Nova version (`nova --version`)
   - Operating system
   - Error messages and logs
   - Steps to reproduce the issue
