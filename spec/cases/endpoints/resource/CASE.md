The docs `api/people/[id].js`: the segment arrives in `params.id`, an unknown
id answers 404 with JSON, `PATCH` merges the JSON it is sent, and `DELETE`
answers 204, after which the id is gone.

Source: `/docs/endpoints`, "A whole resource".
