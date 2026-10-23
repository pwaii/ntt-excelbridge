"""Day 2 pre-start workbook contract. Excel row numbers are one-based."""

from typing import Literal

from pydantic import BaseModel, Field

# Up to 8 current workbooks (input, input_2..input_8) plus one optional main.
SlotName = Literal["input", "input_2", "input_3", "input_4", "input_5", "input_6", "input_7", "input_8", "main"]


class WorkbookSelection(BaseModel):
    sheet_name: str = Field(min_length=1)
    header_row: int = Field(ge=1, le=20)
    header_confirmed: Literal[True]
    key_column: str | None = None  # Physical Excel column ID, e.g. A, AB.
    workbook_version: str = Field(min_length=1)  # SHA-256 of actual uploaded bytes.


class SaveWorkbookConfiguration(BaseModel):
    expected_revision: int = Field(ge=0)
    selections: dict[SlotName, WorkbookSelection]


class WorkbookColumn(BaseModel):
    id: str
    label: str


class WorksheetMetadata(BaseModel):
    name: str
    detected_header_row: int | None
    header_row: int | None
    data_row_count: int
    columns: list[WorkbookColumn]
    errors: list[str] = Field(default_factory=list)


class WorkbookMetadataResponse(BaseModel):
    job_id: str
    slot: SlotName
    workbook_version: str
    size_bytes: int
    header_min: int = 1
    header_max: int = 20
    index_base: Literal[1] = 1
    key_required: bool
    sheets: list[WorksheetMetadata]
    request_id: str
