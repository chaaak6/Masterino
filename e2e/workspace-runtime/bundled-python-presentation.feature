Feature: Local presentation scripts use the bundled Python environment
  Background:
    Given the packaged macOS test app is connected to the test cluster
    And the interface is Simplified Chinese and execution target is local
    And the selected project contains only synthetic presentation fixtures

  Scenario: Discover the runtime without installing host dependencies
    When I ask the agent which Python executable and PPT libraries it can use
    Then its answer identifies the executable inside the app's python-runtime resources
    And running that executable imports pptx, PIL, lxml and xlsxwriter successfully
    And a bare python command resolves to that bundled runtime without a path hint
    And the tool history contains no dependency installation or fixed PPT worker API

  Scenario: Author a polished Chinese presentation with editable charts
    When I request a five-slide quarterly report with KPI cards, charts, a table, a grouped timeline and notes
    Then the agent writes and executes a Python script using the bundled executable
    And the PPTX contains native charts with titles and data labels, styled cells and centered text
    And independent OOXML checks confirm the slide count, values, groups, notes and text geometry
    And the actual rendered pages are checked visually

  Scenario: Read and edit imported groups and table cells
    Given a synthetic imported PPTX with groups, a table, a chart title and notes
    When I ask to inspect those contents and edit a group title and a table value into a new file
    Then the original file hash is unchanged
    And the new file contains the requested edits and the unchanged chart and notes

  Scenario: A damaged input is reported without changing existing files
    When I ask to inspect a damaged PPTX using the bundled Python environment
    Then the agent reports the input error clearly
    And no presentation output is published

  Scenario: Existing local capabilities continue to work
    When I request a simple PPT using the five PptxGenJS tools and a small Excel workbook
    Then the created PPT validates and previews successfully
    And the Excel values read back correctly
    And a project skill and a basic chat response still work
