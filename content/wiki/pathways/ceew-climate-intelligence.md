---
type: Pathway
title: AI for Public Health Early-Warning — National
description: Two AI systems built with the Council on Energy, Environment and Water (CEEW) — a conversational climate-data agent and a dengue early-warning system — and the shared implementation lessons between them.
tags: [Climate, Public Health, Policy]
stage: Pilot
timestamp: 2026-05-01
---

# Overview

AI Diffusion Pathway: Climate Intelligence for Public Decision-Making,
based on practitioner insights led by the Council on Energy, Environment
and Water (CEEW). Draws on two complementary AI systems: **CRAVIS.AI**
(Climate Resilience Analytics and Visualization System), a conversational
agentic AI helping researchers and policymakers search, analyse, and
interact with fragmented climate datasets in natural language; and an
**AI-enabled Early Warning System (EWS)** combining climate, health
surveillance, and geospatial data to forecast dengue outbreaks several
weeks ahead.

**Who it serves.** Researchers and policymakers navigating fragmented
climate datasets (CRAVIS); public health officials deciding where to
deploy limited resources before disease outbreaks occur (EWS).

**Note on source material.** This pathway's source document is
organised as six cross-cutting learnings rather than a stage-by-stage
account, and doesn't carry the same "deployment at a glance" scale
figures the other pathways in this library do. The dimension/stage grid
below is a best-effort mapping; several cells are genuinely thin because
the source material doesn't distinguish that stage explicitly.

# Problem

## Explore

Two different starting problems: CRAVIS addressed an information-access
problem (climate data existed across repositories but was hard to
discover, combine, interpret); the EWS addressed a decision-making
problem (officials had disease surveillance data but no advance warning
of where/when outbreaks would occur).

## Define

Neither deployment began by asking "which AI model should we use?" —
both began with "what decision or task is currently difficult for
users?" Start with the operational bottleneck, not the AI technology.

## Pilot

Not distinctly documented separately from Define in this source.

## Scale

Not distinctly documented separately from Define in this source.

# Persona

## Explore

CRAVIS: researchers and policymakers who must discover, combine, and
interpret climate information before answering relatively simple
questions. EWS: public health officials who must decide where to deploy
limited resources before an outbreak.

## Define

Neither system replaced expert judgement — researchers continued
interpreting climate evidence, officials continued making operational
decisions. AI's role was to support, not replace, existing expertise.

## Pilot

Not distinctly documented separately in this source.

## Scale

Not distinctly documented separately in this source.

# Technology

## Explore

A sophisticated model cannot compensate for fragmented, poorly
governed, or unreliable data — across both projects, data quality
determined success more than model sophistication.

## Define

For the EWS specifically, three data categories proved essential:
health surveillance data, climate observations, and geospatial
information. Climate/geospatial data were relatively accessible
(weather stations, satellite imagery); health data was not — forecasting
performance depended heavily on surveillance-record availability and
granularity.

## Pilot

Neither system reached maturity before deployment — both continued
evolving after launch as users requested new data and models were
refined against real feedback.

## Scale

The EWS tested nearly fifty climate variables and multiple ML models
to identify which approaches improved predictive performance — an
iterative technical process rather than a single model-selection
decision.

# Institution

## Explore

Not distinctly documented separately from Pilot in this source.

## Define

Introduce AI as decision support before embedding it into routine
workflows — trust depended on keeping information grounded in credible,
transparent sources (CRAVIS) and on officials comparing forecasts
against actual outcomes over time (EWS).

## Pilot

Institutions trust systems they can understand, validate, and improve —
not systems that simply claim high accuracy. AI adoption was ultimately
a human process, not a technical one, in both deployments.

## Scale

Long-term ownership requires data stewardship, governance, monitoring,
technical expertise, and ongoing collaboration with implementation
partners — AI systems become more valuable over time only if
institutions are equipped to learn from and update them.

# Ecosystem

## Explore

Not distinctly documented separately in this source.

## Define

AI deployment is a partnership, not a procurement exercise — unlike
conventional software, both systems continued to evolve after
deployment as models improved and institutional needs changed.

## Pilot

For CRAVIS: continuously expanding datasets and refining user
interactions. For the EWS: validating forecasts against real-world
outcomes, incorporating additional datasets, strengthening institutional
confidence over successive cycles.

## Scale

An important gap named explicitly: datasets on mosquito/viral serotype
changes that drive unusually severe dengue outbreaks are rarely publicly
available — diffusion here is not only about sharing AI models, but
about strengthening the broader data ecosystem that enables them.

# Workforce

## Explore

Not distinctly documented separately in this source.

## Define

Not distinctly documented separately in this source.

## Pilot

Researchers and public health officials remained the decision-makers
throughout — the workforce implication is that AI changed how they
accessed information and forecasts, not who made the final call.

## Scale

Not distinctly documented separately in this source.

# Operating Model

## Explore

Not distinctly documented separately in this source.

## Define

Waiting for perfect models or perfect data often delays learning —
early deployment let users validate outputs and provide feedback, and
for the EWS, created incentives for government departments to strengthen
their own disease surveillance and reporting practices.

## Pilot

Considerations named explicitly: assess current data quality without
treating imperfection as a reason to delay indefinitely; build feedback
loops that improve data collection alongside model performance; design
deployment as iterative learning, not one-time implementation.

## Scale

The most valuable asset is the implementation journey, not the trained
model — CEEW's reusable assets include data-integration approaches,
model-evaluation methods, dashboard/visualisation designs, validation
frameworks, stakeholder-engagement approaches, and documentation of
unsuccessful experiments.

# Lessons for the Next Adopter

* Start with the operational bottleneck, not the AI technology — the model follows once the decision or task is clear.
* Audit your data before selecting a model; a sophisticated model cannot compensate for fragmented or ungoverned data.
* Treat deployment as the beginning of learning, not the end of development — waiting for perfect data delays the improvements AI can help create.
* Institutions trust systems they can understand, validate, and improve — build confidence through repeated operational use, not accuracy claims alone.
* Document unsuccessful experiments as carefully as successful ones — the implementation journey is the reusable asset, not the trained model.

# Citations

[1] Diffusion pathway document — `../../All Pathways/4. CEEW /Executive Summary/CEEW Diffusion Pathway.docx`
[2] Interview summary — `../../All Pathways/4. CEEW /Extended Pathway/Otter_summary.pdf`
[3] Interview transcript — `../../All Pathways/4. CEEW /Extended Pathway/Transcript.pdf`

Related pathway: [Data DHARA](data-dhara.md) (shares the "data quality and governance over model sophistication" lesson, applied to government administrative data instead of climate/health data).
