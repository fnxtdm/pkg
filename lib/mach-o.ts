function parseCStr(buf: Buffer) {
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] === 0) {
      return buf.slice(0, i).toString();
    }
  }
}

function patchCommand(type: number, buf: Buffer, file: Buffer) {
  // segment_64
  if (type === 0x19) {
    const name = parseCStr(buf.slice(0, 16));

    if (name === '__LINKEDIT') {
      const fileoff = buf.readBigUInt64LE(32);
      const vmsize_patched = BigInt(file.length) - fileoff;
      const filesize_patched = vmsize_patched;

      buf.writeBigUInt64LE(vmsize_patched, 24);
      buf.writeBigUInt64LE(filesize_patched, 40);
    }
  }

  // symtab
  if (type === 0x2) {
    const stroff = buf.readUInt32LE(8);
    const strsize_patched = file.length - stroff;

    buf.writeUInt32LE(strsize_patched, 12);
  }
}

function patchMachOExecutable(file: Buffer) {
  const align = 8;
  const hsize = 32;

  const ncmds = file.readUInt32LE(16);
  const buf = file.slice(hsize);

  for (let offset = 0, i = 0; i < ncmds; i += 1) {
    const type = buf.readUInt32LE(offset);

    offset += 4;
    const size = buf.readUInt32LE(offset) - 8;

    offset += 4;
    patchCommand(type, buf.slice(offset, offset + size), file);

    offset += size;
    if (offset & align) {
      offset += align - (offset & align);
    }
  }

  return file;
}

export { patchMachOExecutable };
