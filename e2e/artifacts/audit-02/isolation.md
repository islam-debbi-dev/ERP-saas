# isolation

Total 32 · PASS 28 · FAIL 0 · BLOCKED 0

| Area | Check | Result | Expected | Actual |
|---|---|---|---|---|
| B1. Tenant isolation: a foreign key in the body of a fresh draft | a draft sale cannot take another company's client | PASS |  |  |
| B1. Tenant isolation: a foreign key in the body of a fresh draft | a draft sale cannot take another company's product | PASS |  |  |
| B1. Tenant isolation: a foreign key in the body of a fresh draft | a draft sale cannot take another company's dépôt | PASS |  |  |
| B1. Tenant isolation: a foreign key in the body of a fresh draft | a facture cannot group another company's BL with one's own | PASS |  |  |
| B1. Tenant isolation: a foreign key in the body of a fresh draft | a return cannot name another company's sale line | PASS |  |  |
| B1. Tenant isolation: a foreign key in the body of a fresh draft | a draft BR cannot take another company's supplier | PASS |  |  |
| B1. Tenant isolation: a foreign key in the body of a fresh draft | a draft BR cannot take another company's product | PASS |  |  |
| B1. Tenant isolation: a foreign key in the body of a fresh draft | a draft BR cannot join another company's import dossier | PASS |  |  |
| B1. Tenant isolation: a foreign key in the body of a fresh draft | a règlement cannot leave from another company's caisse | PASS |  |  |
| B1. Tenant isolation: a foreign key in the body of a fresh draft | an import cost cannot name another company's supplier | PASS |  |  |
| B1. Tenant isolation: a foreign key in the body of a fresh draft | another company's BR cannot be attached to one's dossier | PASS |  |  |
| B1. Tenant isolation: a foreign key in the body of a fresh draft | a brand cannot point at another company's supplier | PASS |  |  |
| B1. Tenant isolation: a foreign key in the body of a fresh draft | an inventory cannot count another company's product | PASS |  |  |
| B1. Tenant isolation: a foreign key in the body of a fresh draft | a dépôt cannot be limited to another company's brand | PASS |  |  |
| B1. Tenant isolation: a foreign key in the body of a fresh draft | a dépôt cannot be limited to another company's category | PASS |  |  |
| B1. Tenant isolation: a foreign key in the body of a fresh draft | a user cannot be given access to another company's dépôt | PASS |  |  |
| B1. Tenant isolation: a foreign key in the body of a fresh draft | an order cannot be given to another company's livreur | PASS |  |  |
| B1. Tenant isolation: a foreign key in the body of a fresh draft | a delivery cannot name another company's order line | PASS |  |  |
| B1. Tenant isolation: a foreign key in the body of a fresh draft | a dépense cannot leave from another company's caisse | PASS |  |  |
| B1. Tenant isolation: a foreign key in the body of a fresh draft | a payroll draft cannot take a line for another company's employee | PASS |  |  |
| B1. Tenant isolation: a foreign key in the body of a fresh draft | an avance cannot leave from another company's caisse | PASS |  |  |
| B1. Tenant isolation: a foreign key in the body of a fresh draft | salaries cannot be paid from another company's caisse | PASS |  |  |
| B1. Tenant isolation: a foreign key in the body of a fresh draft | a salary payment cannot name another company's employee | PASS |  |  |
| B1. Tenant isolation: verdict | no probe is answered with a row of the other tenant | PASS |  |  |
| B1. Tenant isolation: verdict | no write with a foreign id is accepted | PASS |  |  |
| B1. Tenant isolation: verdict | no probe answers 5xx | PASS |  |  |
| B1. Tenant isolation: verdict | every row of world 1 is unchanged after the sweep (fingerprint of each tenant table) | PASS |  |  |
| B1. Tenant isolation: verdict | foreign keys between tenant tables checked: 150 | INFO |  |  |
| B1. Tenant isolation: verdict | no foreign key of the database joins two tenants | PASS |  |  |
| B1. Tenant isolation: verdict | replay: 187 probes on 128 routes ({"refused":153,"state-first":18,"empty":16}); 0 recorded requests not aligned | INFO |  |  |
| B1. Tenant isolation: verdict | brute force: 7480 probes on 88 routes ({"refused":4675,"state-first":2720,"empty":85}) | INFO |  |  |
| B1. Tenant isolation: verdict | routes with an id in the path: 174; replayed with a valid body: 86; brute force only: 88; not covered: 0  | INFO |  |  |