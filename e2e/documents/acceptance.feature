@local-documents
Feature: Local large document processing
  The agent receives bounded evidence from the full local file and verified artifacts.

  Scenario: Inspect a small compressed workbook with a worksheet larger than one GiB
    Given a workbook whose worksheet expands beyond one GiB
    When the agent inspects the file
    Then inspection lists its sheet and recommends dataset analysis without reading its rows

  Scenario: Compute specifications without treating absent or erroneous measurements as passed
    Given a workbook with known measurements, missing values and cached formulas
    When the agent analyzes the measurement columns together
    Then the full scan reports exact pass fail and incomplete counts

  Scenario: Reuse an analysis dataset for a different grouping and exact deduplication
    Given a workbook with known measurements, missing values and cached formulas
    When the agent analyzes the measurement columns together
    And the agent queries the existing dataset by category
    Then the query returns the known groups without parsing the workbook again

  Scenario: Handle a million rows with bounded output
    Given a million row workbook
    When the agent analyzes the measurement columns together
    Then it reports one million scanned rows and a bounded result

  Scenario: Preserve existing simple Office reading and creation
    Given a workbook with known measurements, missing values and cached formulas
    When the agent reads a selected Office range
    Then the known cells and formulas remain readable

  Scenario: Read and search only relevant PDF pages
    Given a three page PDF
    When the agent reads page two and searches the PDF
    Then results contain page two evidence and bounded search matches

  Scenario: Stream a large attachment into a device owned snapshot
    Given a fresh attachment transfer
    When the selected file is transferred in bounded chunks
    Then its content is available only to the bound conversation

  Scenario: Analyze CSV and retrieve filtered evidence without source reparsing
    Given a CSV file with known measurements
    When the agent analyzes the measurement columns together
    And the agent requests filtered row evidence
    Then the matching rows and numeric quality counts are exact

  Scenario: Bound group output while keeping the full scan accurate
    Given a workbook with known measurements, missing values and cached formulas
    When the agent analyzes the measurement columns together
    And the agent queries with a bounded group limit
    Then omitted groups are marked explicitly and counts remain exact
