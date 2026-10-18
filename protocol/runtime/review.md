# Review phase

Review the exact candidate, including submitted uncommitted content, in two axes:
spec adherence and repository standards. For each finding identify the requirement
or standard, affected path and observed evidence. Distinguish missing behavior,
reproduced defects, inconclusive measurements and non-blocking design suggestions.

Static reading does not prove runtime behavior. A blocker requires an executed
failing test or check; heuristics remain suggestions. Never repair the implementation
as reviewer. Do not import the builder's reasoning. Report both axes even if one
has no findings. Where the project's conventions are silent, the standards axis applies
the `squad-code-smells` baseline as suggestions. A separate context alone does not demonstrate capability isolation.
