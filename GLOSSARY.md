# Glossary

## Tool availability

The effective tools and call restrictions produced by combining plan mode with the
current subagent preference. It also determines delegated access. One module owns
this decision for each extension runtime; registering or executing tools is separate.

## Plan mode

The read-only planning state. It blocks write tools and unsafe bash calls in the
parent agent, and restricts newly launched subagents to native read-only tools.
User approval leaves plan mode before implementation starts.

## Subagent access

The tools granted to a delegated Pi process when it starts: `full` outside plan
mode or `read-only` during plan mode. Enabling subagents allows delegation; it does
not override plan mode. Running processes keep their initial tool selection.
