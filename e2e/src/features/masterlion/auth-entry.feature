@masterlion @auth @onboarding @smoke
Feature: Masterion auth entry
  Users should be able to enter registration and login flows from protected routes.

  Background:
    Given the application is running

  @MASTERLION-AUTH-001 @P0
  Scenario: Onboarding redirects anonymous users to login and auth forms render
    Given I use a fresh unauthenticated browser session
    When I visit the onboarding entry
    Then I should land on the signin page with onboarding callback
    And I should see the login entry form
    When I open the signup page
    Then I should see the registration form
    When I open the signin page
    Then I should see the login entry form
