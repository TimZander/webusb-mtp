# mtp-codec Specification

## Purpose
Encode and decode the bytes MTP carries over USB: containers (command, data, response, event)
and the datasets inside data containers, and name codes for logs. Pure and DOM-free.

## Requirements

### Requirement: Containers are encoded little-endian
The library SHALL encode an MTP container as a 12-byte little-endian header (u32 total length,
u16 type, u16 code, u32 transaction id) followed by up to five u32 params for a command or a
response, or by a raw payload for a data container. It SHALL refuse more than five params.

#### Scenario: Command with params
- **WHEN** a command container with code `0x1007`, transaction id `5` and params `1`, `0`, `0xFFFFFFFF` is encoded
- **THEN** the result is 24 bytes: length `24`, type `1`, code `0x1007`, transaction id `5`, then the three params, all little-endian

#### Scenario: Data container
- **WHEN** a data container with a 3-byte payload is encoded
- **THEN** the result is 15 bytes, type `2`, with the payload after the header

#### Scenario: Too many params
- **WHEN** a container with six params is encoded
- **THEN** encoding throws an error naming the five-param limit

### Requirement: Containers are decoded whole or refused
The library SHALL decode a container's header and, for command, response and event containers,
up to five u32 params from its body; a data container's body SHALL be returned whole as its
payload with no params. A buffer shorter than 12 bytes, or shorter than the length its header
states, SHALL be refused with an error.

#### Scenario: Response with params
- **WHEN** an encoded response with code `0x2001` and params `7`, `8` is decoded
- **THEN** the decoded container has type `3`, code `0x2001` and params `7`, `8`

#### Scenario: Data payload
- **WHEN** a data container whose payload happens to be eight bytes is decoded
- **THEN** its payload is the eight bytes and it has no params

#### Scenario: Truncated buffer
- **WHEN** a buffer's header states 20 bytes and the buffer holds 16
- **THEN** decoding throws an error saying the container is truncated

### Requirement: Codes have readable names
The library SHALL name the codes in its exported `OperationCode`, `ResponseCode` and `EventCode`
tables (for example `GetStorageIDs`, `GeneralError`, `ObjectAdded`), name any other code `Unknown operation`,
`Unknown response` or `Unknown event`, and format a code as upper-case hex with at least four
digits.

#### Scenario: Known and unknown codes
- **WHEN** the names of operation `0x1004`, response `0x2002` and operation `0x9999` are asked for
- **THEN** they are `GetStorageIDs`, `GeneralError` and `Unknown operation`

#### Scenario: Code format
- **WHEN** code `0x101b` is formatted
- **THEN** it reads `0x101B`

### Requirement: Dataset primitives follow MTP's encoding
The library SHALL read and write MTP dataset values little-endian: u8, u16, u32, u64 (as a
number, exact up to 2^53), arrays (a u32 count, then the elements) and strings (a u8 count of
UTF-16 code units including the NUL terminator, then the units; an empty string is one `0`
byte). A read past the end SHALL throw; writing a string of over 254 units SHALL throw.

#### Scenario: String round trip
- **WHEN** the string `Größe` is written and read back
- **THEN** the same string is read, and the bytes start with count `6`

#### Scenario: Empty string
- **WHEN** an empty string is written
- **THEN** it is the single byte `0`, and reads back as an empty string

#### Scenario: String too long
- **WHEN** a string of 255 characters is written
- **THEN** writing throws an error naming the 254-character limit

#### Scenario: Large u64
- **WHEN** a u64 of `5 * 2^32 + 7` is read
- **THEN** the number `21474836487` is returned

#### Scenario: Read past the end
- **WHEN** a u32 is read from two remaining bytes
- **THEN** the read throws an error saying it runs past the end

### Requirement: Standard datasets are decoded
The library SHALL decode the DeviceInfo, StorageInfo and ObjectInfo datasets into named fields,
and storage id and object handle arrays into number arrays. An ObjectInfo whose format is
Association (`0x3001`) SHALL be marked as a folder.

#### Scenario: Device info
- **WHEN** a DeviceInfo dataset for manufacturer `Example Corp` and model `Model X` is decoded
- **THEN** the result carries that manufacturer and model, the supported operations and the other DeviceInfo fields

#### Scenario: Storage info
- **WHEN** a StorageInfo dataset with a capacity above 4 GiB is decoded
- **THEN** the result carries the exact capacity, the free space and both labels

#### Scenario: A folder
- **WHEN** an ObjectInfo with format `0x3001` is decoded
- **THEN** the result is marked as a folder

### Requirement: ObjectInfo is encoded for sending
The library SHALL encode an ObjectInfo dataset from a storage id, format, size, parent, association
type, file name and optional dates, with every other field zero or empty, so that decoding it
gives back the same values.

#### Scenario: Round trip
- **WHEN** an ObjectInfo for file `a.bin` of 1234 bytes in parent `7` is encoded and decoded
- **THEN** the decoded file name, size, parent and format equal the encoded ones
