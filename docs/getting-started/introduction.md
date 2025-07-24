# What is Nova? 🚀

!!! abstract "Overview"
    Nova is an intelligent CLI tool that enhances project management and development workflows. It provides:
    - 🔄 Seamless integration with development platforms (Jira, GitLab, GitHub, Confluence)
    - 🔑 Unified authentication and profile management
    - 📊 Project analytics and insights
    - 📝 Documentation access and search

## Core Features

!!! "Platform Integration
    !!! info Unified Platform Access
        Nova centralizes access to your development platforms:

        - **Jira**: Project and issue tracking
        - **GitLab**: Repository and CI/CD management
        - **GitHub**: Repository and CI/CD management
        - **Confluence**: Documentation management

    !!!+ Example Integration Usage
        ```bash
        # View Jira dashboard
        nova jira dashboard
        
        # Check GitLab metrics
        nova gitlab dashboard
        
        # Search Confluence
        nova confluence search "query"
        ```

!!! "+ Analytics and Insights :chart_with_upwards_trend:
    !!! info Project Metrics
        Get insights across your development ecosystem:

        - Project health metrics
        - Engineering analytics
        - Documentation coverage
        - Activity tracking

    !!!+ Example Analytics Commands
        ```bash
        # View Jira metrics
        nova jira dashboard --days 30
        
        # Check GitLab stats
        nova gitlab dashboard --refresh
        ```

## Getting Started

!!! tip Quick Start
    For a standard installation: `brew tap ... to be done`

## Configuration

!!! note "Config Options"
    Nova can be configured through:
    
    1. Interactive setup:
       ```bash
       nova setup
       ```
    
    2. Environment variables:
       ```bash
       export ATLASSIAN_TOKEN="your-token"
       export GITLAB_TOKEN="your-token"
       ```

## Common Workflows

!!! example "Example Usage"
    1. Project Overview:
       ```bash
       # Check Jira status
       nova jira dashboard
       
       # View GitLab metrics
       nova gitlab dashboard
       ```
    
    2. Documentation:
       ```bash
       # List Confluence spaces
       nova confluence spaces
       
       # Search documentation
       nova confluence search "topic"
       ```

## Support

!!! question Need Help?
    - Use `nova <command> --help` for command details
    - Check documentation at `/docs`
    - Enable shell completions for command hints
    - Use `--format json` for programmatic output
