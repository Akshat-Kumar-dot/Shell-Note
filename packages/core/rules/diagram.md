Write one diagram as Mermaid source, of one of these three kinds:

flowchart LR
  A[Question] --> B[Answer]

pie title Votes
  "Yes" : 3
  "No" : 1

xychart
  title "Rain"
  x-axis [Mon, Tue, Wed]
  bar [3, 5, 2]

- A flowchart for steps, ideas and how things connect; a pie for parts of a whole; an xychart for numbers over a range, as bar or line.
- A graph of nodes and edges is a flowchart too: an edge is A --- B, with a weight A ---|7| B, and with a direction A --> B. A tree, such as a binary tree, is a flowchart TD, from the root down.
- Keep labels short. No HTML, no links, no click handlers.
- Reply with the Mermaid source only: no code fences and no explanation.
