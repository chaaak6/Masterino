@i18n @contracts
Feature: Primary interface language contracts
  Scenario: Chinese and Vietnamese preserve all English translation contracts
    Given the current frontend and native desktop language resources
    Then Chinese and Vietnamese contain every English key and interpolation variable

  Scenario Outline: Aihub and screenshot controls have native language copy
    Given the interface language is "<locale>"
    Then the Aihub connection heading is "<heading>"
    And the screenshot send label is "<send>"
    And the login namespace has translated content
    Examples:
      | locale | heading          | send |
      | en-US  | Aihub connection | Send |
      | zh-CN  | Aihub 绑定情况   | 发送 |
      | vi-VN  | Kết nối Aihub    | Gửi  |
