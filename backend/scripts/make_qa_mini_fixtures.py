"""Generate mini QA workbooks (~40-80 rows each) for fast smoke tests.

Same stress rows as qa/, fewer normal rows.
Run from ``backend``:  .venv312/python.exe -m scripts.make_qa_mini_fixtures
"""

from __future__ import annotations

from pathlib import Path

from scripts.make_qa_fixtures import (
    FIXTURE_SPECS,
    HR_HEADERS,
    INVENTORY_HEADERS,
    REGISTRY_HEADERS,
    RETAIL_HEADERS,
    VISIT_HEADERS,
    _catalog_rows,
    _hr_master_rows,
    _hr_rows,
    _registry_rows,
    _retail_rows,
    _shipment_rows,
    _visit_rows,
    _write_hr_employees,
    _write_workbook,
)

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
OUT_DIR = REPO_ROOT / "sample-data" / "qa-mini"


def write_fixtures(out_dir: Path) -> list[Path]:
    outputs = {k: out_dir / k for k in FIXTURE_SPECS}

    # Retail: pool is 1190 normal + 10 stress
    retail = _retail_rows()
    _write_workbook(outputs["retail/orders_online.xlsx"], RETAIL_HEADERS, retail[:50], "Online Orders")
    _write_workbook(outputs["retail/orders_store.xlsx"], RETAIL_HEADERS, retail[50:100] + retail[1190:], "Store Orders")

    # HR: pool is 592 normal + 8 stress; corporate gets header_row=3 via _write_hr_employees
    hr = _hr_rows()
    _write_hr_employees(outputs["hr/employees_corporate.xlsx"], hr[:50], "Corporate Employees")
    _write_workbook(outputs["hr/employees_field.xlsx"], HR_HEADERS, hr[50:90] + hr[592:], "Field Employees")
    _write_workbook(outputs["hr/hr_master.xlsx"], HR_HEADERS, _hr_master_rows(), "HR Master")

    # Inventory: pool is 894 normal + 6 stress; catalog duplicates are at indices 41-42 (within 80)
    ship = _shipment_rows()
    _write_workbook(outputs["inventory/shipment_north.xlsx"], INVENTORY_HEADERS, ship[:50], "North Shipment")
    _write_workbook(outputs["inventory/shipment_south.xlsx"], INVENTORY_HEADERS, ship[50:100], "South Shipment")
    _write_workbook(outputs["inventory/shipment_west.xlsx"], INVENTORY_HEADERS, ship[100:140] + ship[894:], "West Shipment")
    _write_workbook(outputs["inventory/catalog.xlsx"], INVENTORY_HEADERS, _catalog_rows()[:80], "Catalog")

    # Clinic: pool is 993 normal + 7 stress; registry duplicates at indices 40-41 (within 60)
    visit = _visit_rows()
    _write_workbook(outputs["clinic/visits_north.xlsx"], VISIT_HEADERS, visit[:50], "North Visits")
    _write_workbook(outputs["clinic/visits_south.xlsx"], VISIT_HEADERS, visit[50:100], "South Visits")
    _write_workbook(outputs["clinic/visits_east.xlsx"], VISIT_HEADERS, visit[100:150], "East Visits")
    _write_workbook(outputs["clinic/visits_west.xlsx"], VISIT_HEADERS, visit[150:190] + visit[993:], "West Visits")
    _write_workbook(outputs["clinic/registry.xlsx"], REGISTRY_HEADERS, _registry_rows()[:60], "Registry")

    return list(outputs.values())


def main() -> None:
    for path in write_fixtures(OUT_DIR):
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
