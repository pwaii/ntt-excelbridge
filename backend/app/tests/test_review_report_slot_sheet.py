"""Regression: the transformation report must resolve each proposal slot's own sheet.

build_report's tool3 formula-verification block opened the proposal's slot workbook but
indexed it with the primary input's `config.input_sheet`, raising KeyError (500) when a
secondary input used a different sheet name (North/South/West Shipment)."""

from app.services.review_report import _slot_sheet_header


def test_slot_sheet_header_reads_secondary_selection_not_primary_config():
    item = {
        "config": {"input_sheet": "North Shipment", "input_header_row": 1,
                   "main_sheet": "Catalog", "main_header_row": 2},
        "workbook_selections": {"input_3": {"sheet_name": "West Shipment", "header_row": 3}},
    }
    assert _slot_sheet_header(item, "input") == ("North Shipment", 1)
    assert _slot_sheet_header(item, "main") == ("Catalog", 2)
    # The secondary slot must NOT inherit the primary's "North Shipment".
    assert _slot_sheet_header(item, "input_3") == ("West Shipment", 3)
    # A slot with no recorded selection falls back to (None -> first sheet, header 1).
    assert _slot_sheet_header(item, "input_2") == (None, 1)
