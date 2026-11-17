The docs `api/people.js`: `GET` answers the list as JSON, `POST` answers 201
with the JSON it was sent, and `PUT`, which the file does not export, answers
405 with `Allow: GET, POST`.

Source: `/docs/endpoints`, the first example and the three calls under it.
