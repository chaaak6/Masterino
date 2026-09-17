@live-test @file-access
Feature: Browser access to private OSS files
  Private files remain in OSS while browsers receive short-lived public signed URLs.

  Background:
    Given a private file fixture is configured for browser access

  @FILE-ACCESS-001 @P0
  Scenario: Preview redirects to the public OSS bucket
    When I request the stable file URL without following redirects
    Then the file response status should be 302
    And the redirect host should equal the configured public bucket host
    And the redirect host should not contain "-internal"
    When I follow the signed file redirect
    Then OSS should return the configured fixture content

  @FILE-ACCESS-002 @P0
  Scenario: Explicit download redirects to the public OSS bucket
    When I request the stable file URL as a download without following redirects
    Then the file response status should be 302
    And the redirect host should equal the configured public bucket host
    And the redirect host should not contain "-internal"
    And the signed redirect should request attachment disposition
    When I follow the signed file redirect
    Then OSS should return the configured fixture content
    And the OSS response should use attachment disposition
