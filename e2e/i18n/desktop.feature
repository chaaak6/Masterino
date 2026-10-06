@i18n @desktop @live
Feature: Interface language in an isolated desktop profile on the test cluster
  Background:
    Given an isolated desktop connected only to the test cluster

  Scenario Outline: Language selection reaches the renderer, native menu and screenshot window
    When I select interface language "<locale>"
    Then the onboarding description is translated
    And the native edit menu is translated
    And a new screenshot window uses the selected language
    Examples:
      | locale |
      | en-US  |
      | zh-CN  |
      | vi-VN  |

  Scenario: Vietnamese survives a desktop restart
    When I select interface language "vi-VN"
    And I restart the isolated desktop
    Then the onboarding description is translated
