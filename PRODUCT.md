# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Scope

This record covers the local Easy Quote evaluation tool launched with `npm run eval:start`, not the customer-facing application. Application domain terminology lives in `CONTEXT.md`.

## Users

The developer uses this tool locally on their own machine to test models against Easy Quote scenarios.

## Product Purpose

Configure Evaluation Sessions using existing scenarios and inspect why individual Scenario Runs failed. Selecting existing scenarios is the usual launch workflow. Cross-session model comparison and custom-input authoring are outside this redesign.

## Operating Context

The evaluator is a standalone local web server. It saves session plans, progress, Scenario Run results and human reviews locally. It is separate from the production application and uses an isolated evaluation database.

## Capabilities and Constraints

Preserve scenario selection, provider and model settings, reasoning, repetitions, execution limits, explicit Start authorization, progress, Stop, settings reuse, saved results and human review. Preserve access to scenario inputs, expectations, Quote comparisons, conversation and tool diagnostics.

Provide light and dark themes, initially following the system preference and remembering an explicit choice on this browser.

Distinguish execution status, automated outcomes and human review. A completed session does not mean its Scenario Runs passed. Reserved budget and estimated usage cost are different values. Redesigning the interface does not authorize paid provider calls.

## Product Principles

- Make selecting scenarios and configuring an evaluation direct.
- Prioritize evidence that explains failed Scenario Runs.
- Keep reference material and technical details available without making them dominate routine tasks.
- Preserve existing execution and data-isolation safeguards.
