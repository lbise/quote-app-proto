# Easy Quote

Easy Quote helps small artisan businesses prepare customer-ready quotes with less administrative work.

## Language

**Artisan Business**:
A sole artisan or very small company that performs skilled trade work for customers and prepares quotes for that work. Customers and Quotes belong to the Artisan Business, not to an individual Artisan.
_Avoid_: Vendor, contractor, account

**Artisan**:
A person in an Artisan Business who understands the proposed work and supplies the quantities and materials needed for a quote.
_Avoid_: Operator, salesperson

**Customer**:
A reusable record of the person or organization for whom an Artisan Business proposes work.
_Avoid_: Client, buyer, account

**Quote**:
A commercial record belonging to an Artisan Business that describes proposed work for a Customer, identified by a reference unique within that business and fixed after first Publication. Its customer-facing language is independent of the Artisan's interface language.
_Avoid_: Estimate, invoice, proposal

**Working Draft**:
The editable version of a Quote being prepared, whose details, quantities, and prices may be incomplete. A Quote has at most one Working Draft, initially prepared from scratch or based on its latest Published Revision.

**Published Revision**:
A numbered version of a Quote whose customer-facing commercial content and calculated amounts are frozen by Publication. Published Revisions start at 1 and increase with each Publication, not with individual edits.
_Avoid_: Sent Quote, accepted Quote

**Publication**:
An Artisan's explicit approval of a Working Draft for sharing with its Customer, creating a Published Revision that cannot be undone or overwritten. Publication does not establish Customer receipt or acceptance.

**Quote Line**:
A part of a Quote that describes proposed work or material, independently editable in a Working Draft and numbered consecutively in the Quote's current line order. Its price, when supplied, is either calculated from a quantity and unit price or entered as a fixed amount.
_Avoid_: Quote item, catalog entry

**Quote Section**:
An optional named group of Quote Lines within a Quote, used to organize work by room, trade or phase and show a subtotal.
_Avoid_: Chapter, sub-quote

**Quote Discount**:
An unconditional reduction of a Quote's price before VAT, expressed as either a percentage or a fixed monetary amount.
_Avoid_: Early-payment discount, negative Quote Line

## Evaluation language

**Evaluation Session**:
A deliberately started group of Scenario Runs sharing execution settings and a budget, used to evaluate Easy Quote's agent tools and a model's ability to produce the expected Quote state from realistic inputs.
_Avoid_: Run when referring to the whole session

**Scenario Run**:
One execution of an evaluation scenario, with its own produced Quote state, automated checks and human reviews. Each repetition is a separate Scenario Run within an Evaluation Session.
_Avoid_: Session when referring to an individual scenario execution
