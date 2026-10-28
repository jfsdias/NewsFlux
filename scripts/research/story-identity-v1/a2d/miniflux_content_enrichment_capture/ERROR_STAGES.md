# Capture failure stages

The first attempt lost its response bytes and status before recording its
failure. Its original `ValueError` cannot be assigned to a single cause. It
remains noncanonical; the replacement begins with all 500 frozen identities.

Exceptions are converted to stable codes without exception messages, local
variables or traceback output. The safe diagnostic can report the exception
class, stage, code, article ID, HTTP status, whether a body was received,
whether the secret scan passed, whether the payload was frozen and its hash.

| Stage               | Potential failures                                                                    | Payload state                                                                                |
| ------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| HTTP_RESPONSE       | Transport, authorization, response or retry policy                                    | Unavailable on transport failure; a safe final body is frozen if retry policy cannot proceed |
| SECRET_SCAN         | Missing credential, token or nonempty sensitive metadata in bytes                     | Never persisted when the scan fails                                                          |
| RAW_PAYLOAD_HASH    | Hash calculation or byte-type error                                                   | Not yet frozen                                                                               |
| RAW_PAYLOAD_FREEZE  | Path, atomic write, permissions, fsync, digest or readback failure                    | Not accepted as frozen unless verified                                                       |
| JSON_DECODE         | JSON decoding or encoding error                                                       | Frozen and hashed                                                                            |
| JSON_SHAPE          | Invalid JSON root                                                                     | Frozen and hashed                                                                            |
| IDENTITY_EXTRACTION | Missing identity field or invalid field type                                          | Frozen and hashed                                                                            |
| IDENTITY_VALIDATION | Invalid timestamp, title, URL or comparison                                           | Frozen and hashed                                                                            |
| CONTENT_EXTRACTION  | Error extracting stored content                                                       | Frozen and hashed                                                                            |
| CONTENT_TYPE        | Error checking content representation; unsupported values remain a contractual status | Frozen and hashed                                                                            |
| NORMALIZATION       | Parser, text conversion or classification error                                       | Frozen and hashed                                                                            |
| CONTENT_HASH        | UTF-8 encoding or content-hash error                                                  | Frozen and hashed                                                                            |
| ROW_DERIVATION      | Sidecar construction error                                                            | Frozen and hashed                                                                            |
| PAYLOAD_INDEX       | Mapping, missing payload, length or digest error                                      | Frozen payload is not accepted if validation fails                                           |
| SIDECAR_WRITE       | Private sidecar, index, receipt or manifest write error                               | Individual raw payloads remain frozen                                                        |
| VALIDATION          | Input pins, membership, aggregate or independent replay failure                       | Depends on capture progress                                                                  |
| FREEZE              | Final private permissions, rehash or secret gate                                      | Individual raw payloads remain frozen                                                        |

Raw-response SHA-256 covers exact final HTTP body bytes. Raw-content SHA-256
covers UTF-8 bytes of the JSON-decoded `entry.content` string, before
normalization. Normalized-content SHA-256 covers UTF-8 bytes after D2E1
normalization. Neither contents nor credential values are printed or tracked.
