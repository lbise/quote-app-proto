#!/usr/bin/env python3
"""Independently calculate checked-in scenario expectations with Decimal, never app code."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any

CENT = Decimal("0.01")
ROOT = Path(__file__).resolve().parents[1]
EXPECTED_FILE = ROOT / "eval/expected-calculations.json"
REFERENCES = {
    "joinery-reference.json": (("26854.30", "2175.20", "29029.50"), [120_000, 480_000, 190_000, 70_000, 189_900, 120_000, 333_380, 33_280, 63_200, 38_000, 18_000, 75_770, 24_000, 138_250, 38_000, 11_200, 23_710, 24_000, 37_130, 76_000, 12_800, 131_280, 48_000, 242_530, 15_000, 25_690, 37_130, 15_000, 22_580, 31_600]),
    "landscape-reference.json": (("15032.00", "1217.59", "16249.59"), [20_000, 528_000, 180_000, 54_000, 11_200, 33_000, 85_000, 255_000, 130_000, 43_200, 5_400, 9_400, 45_000, 104_000]),
    "civil-works-reference.json": (("9311.50", "754.23", "10065.73"), [80_000, 24_000, 108_300, 8_000, 49_600, 45_000, 117_000, 22_000, 78_000, 17_000, 114_000, 10_000, 56_500, 75_000, 27_500, 78_000, 21_250]),
}


def money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def cents(value: Decimal) -> int:
    return int(money(value) * 100)


def dump_expected_quotes() -> dict[str, dict[str, Any]]:
    env = {**os.environ, "GENERATE_EXPECTED_CALCULATIONS": "1"}
    program = "import { scenarios } from './eval/scenarios.ts'; console.log(JSON.stringify(Object.fromEntries(scenarios.map((s) => [s.id, s.expectedQuote]))));"
    output = subprocess.run(["npx", "tsx", "-e", program], cwd=ROOT, env=env, check=True, text=True, capture_output=True).stdout
    return json.loads(output)


def absent(problems: list[dict[str, str]], path: str) -> None:
    problem = {"path": path, "code": "required"}
    if problem not in problems:
        problems.append(problem)


def ordered_lines(quote: dict[str, Any]) -> list[dict[str, Any]]:
    sections = quote["sections"]
    known = {section["id"] for section in sections}
    unsectioned = [line for line in quote["lines"] if line["sectionId"] == ""]
    grouped = [line for section in sections for line in quote["lines"] if line["sectionId"] == section["id"]]
    unknown = [line for line in quote["lines"] if line["sectionId"] not in known and line["sectionId"] != ""]
    return unsectioned + grouped + unknown


def decimal_or_missing(value: str, path: str, missing: list[dict[str, str]]) -> Decimal | None:
    if not value.strip():
        absent(missing, path)
        return None
    return Decimal(value.replace(",", "."))


def calculate_expected(quote: dict[str, Any]) -> dict[str, Any]:
    """The agreed Quote arithmetic reproduced independently with Decimal."""
    errors: list[dict[str, str]] = []
    missing: list[dict[str, str]] = []
    for field in ["reference", "title", "customerName", "customerAddress", "businessName", "businessAddress", "businessContact", "issueDate"]:
        if not quote[field].strip():
            absent(missing, field)
    if quote["vatRegistered"] is None:
        absent(missing, "vatRegistered")
    elif quote["vatRegistered"] and not quote["vatId"].strip():
        absent(missing, "vatId")

    lines = ordered_lines(quote)
    section_ids = {section["id"] for section in quote["sections"]}
    line_amounts: list[int | None] = []
    for index, line in enumerate(lines):
        path = f"lines[{index}]"
        if not line["description"].strip():
            absent(missing, f"{path}.description")
        if line["sectionId"] and line["sectionId"] not in section_ids:
            errors.append({"path": f"{path}.sectionId", "code": "unknown_section"})
        amount: int | None = None
        if line["mode"] == "fixed":
            fixed = decimal_or_missing(line["amount"], f"{path}.amount", missing)
            if fixed is not None:
                amount = cents(fixed)
        elif line["mode"] == "quantity":
            quantity = decimal_or_missing(line["quantity"], f"{path}.quantity", missing)
            price = decimal_or_missing(line["unitPrice"], f"{path}.unitPrice", missing)
            if not line["unit"].strip():
                absent(missing, f"{path}.unit")
            if quantity == Decimal("0"):
                errors.append({"path": f"{path}.quantity", "code": "must_be_positive"})
            if quantity not in (None, Decimal("0")) and price is not None and line["unit"].strip():
                amount = cents(quantity * price)
        else:
            errors.append({"path": f"{path}.mode", "code": "invalid_value"})
        line_amounts.append(amount)

    if not lines:
        absent(missing, "lines")
    subtotal = sum((amount or 0) for amount in line_amounts)
    incomplete_pricing = not lines or any(amount is None for amount in line_amounts)
    sections = []
    for section in quote["sections"]:
        values = [amount for line, amount in zip(lines, line_amounts) if line["sectionId"] == section["id"]]
        sections.append({"subtotal": sum(amount or 0 for amount in values), "incomplete": any(amount is None for amount in values)})

    discount: int | None
    if quote["discountMode"] == "none":
        discount = None if incomplete_pricing else 0
    elif quote["discountMode"] == "percent":
        rate = decimal_or_missing(quote["discount"], "discount", missing)
        discount = None if incomplete_pricing or rate is None else cents(Decimal(subtotal) / 100 * rate / 100)
    elif quote["discountMode"] == "fixed":
        fixed = decimal_or_missing(quote["discount"], "discount", missing)
        discount = None if incomplete_pricing or fixed is None else cents(fixed)
    else:
        errors.append({"path": "discountMode", "code": "invalid_value"})
        discount = None
    net = None if discount is None else subtotal - discount
    vat = None if net is None or quote["vatRegistered"] is not True else cents(Decimal(net) / 100 * Decimal("0.081"))
    total = None if net is None or quote["vatRegistered"] is None else net + (vat or 0)
    complete = not errors and not missing and not incomplete_pricing and total is not None
    return {
        "lines": [{"amount": amount} for amount in line_amounts],
        "sections": sections,
        "subtotal": subtotal,
        "discount": discount,
        "net": net,
        "vat": vat,
        "total": total,
        "complete": complete,
        "missing": missing,
        "errors": errors,
    }


def check_reference(name: str, expected: tuple[tuple[str, str, str], list[int]]) -> None:
    expected_totals, expected_cents = expected
    fixture = json.loads((ROOT / "docs/examples/first-quotes" / name).read_text())
    amounts: list[Decimal] = []
    for section in fixture["sections"]:
        for position in section["lines"]:
            actual = Decimal(position["amount"]) if position["kind"] == "fixed" else money(Decimal(position["quantity"]) * Decimal(position["unitPrice"]))
            assert actual == Decimal(position["amount"]), (name, position["number"], actual, position["amount"])
            amounts.append(actual)
    assert [int(value * 100) for value in amounts] == expected_cents, name
    subtotal = sum(amounts, Decimal("0"))
    vat = money(subtotal * Decimal("0.081"))
    total = subtotal + vat
    assert (subtotal, vat, total) == tuple(map(Decimal, expected_totals)), (name, subtotal, vat, total)


def check_synthetic_and_adapted_arithmetic() -> None:
    assert money(Decimal("43.750") * Decimal("79.00")) == Decimal("3456.25")
    assert money(Decimal("12.500") * Decimal("40.00")) == Decimal("500.00")
    assert money(Decimal("4.700") * Decimal("79.00")) == Decimal("371.30")
    assert money(Decimal("40.000") * Decimal("79.00")) == Decimal("3160.00")
    assert money(Decimal("18.000") * Decimal("3.00")) == Decimal("54.00")
    source_subtotal = Decimal("3333.80") + Decimal("240.00")
    source_discount = money(source_subtotal * Decimal("0.10"))
    source_net = source_subtotal - source_discount
    assert (source_subtotal, source_discount, money(source_net * Decimal("0.081")), source_net + money(source_net * Decimal("0.081"))) == (
        Decimal("3573.80"), Decimal("357.38"), Decimal("260.53"), Decimal("3476.95"),
    )
    assert money(Decimal("42.200") * Decimal("71.10")) == Decimal("3000.42")
    assert money(Decimal("8.000") * Decimal("71.10")) == Decimal("568.80")
    synthetic_line = money(Decimal("0.125") * Decimal("80.20"))
    assert synthetic_line == Decimal("10.03")
    assert synthetic_line + money(synthetic_line * Decimal("0.081")) == Decimal("10.84")
    assert money(Decimal("4.25") * Decimal("2.80") * Decimal("79.00")) == Decimal("940.10")
    # Fictional contract quantities, calculated here rather than by app code.
    assert money(Decimal("7") * Decimal("18.40")) == Decimal("128.80")
    assert money(Decimal("12.75") * Decimal("6.80")) == Decimal("86.70")


def main() -> None:
    authored = dump_expected_quotes()
    calculated = {scenario_id: calculate_expected(quote) for scenario_id, quote in authored.items()}
    # Fictional contract Artisan is not VAT-registered; totals are the supplied line prices.
    for scenario_id, cents in {
        "contract-fixed-line": 48650,
        "contract-quantity-line": 12880,
        "contract-section-assignment": 9200,
        "contract-split-evidence": 8670,
        "contract-mixed-batches": 78430,
    }.items():
        result = calculated[scenario_id]
        assert (result["net"], result["vat"], result["total"]) == (cents, None, cents)
    assert [section["subtotal"] for section in calculated["contract-mixed-batches"]["sections"]] == [42250, 36180]
    # Hand-worked check: CHF 3573.80 less 10% = CHF 3216.42, plus CHF 260.53 VAT.
    percent = calculated["joinery-percent-discount"]
    assert (percent["discount"], percent["net"], percent["vat"], percent["total"]) == (35738, 321642, 26053, 347695)
    if "--write" in sys.argv:
        EXPECTED_FILE.write_text(json.dumps(calculated, indent=2, ensure_ascii=False) + "\n")
    else:
        checked_in = json.loads(EXPECTED_FILE.read_text())
        assert calculated == checked_in, "eval/expected-calculations.json is stale; run python3 eval/expectations.py --write"
    for filename, expected in REFERENCES.items():
        check_reference(filename, expected)
    check_synthetic_and_adapted_arithmetic()
    print("Decimal expectations verified")


if __name__ == "__main__":
    main()
