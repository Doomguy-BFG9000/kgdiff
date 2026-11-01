import { describe, expect, it } from 'vitest';
import { detectFormat, FORMAT_EXTENSIONS, type FormatId, parseGraph } from '../src/index.js';
import { catchError, fixture } from './helpers.js';

describe('detectFormat by file name', () => {
  it.each([
    ['graph.json', 'json'],
    ['graph.kgdiff.json', 'json'],
    ['people.ttl', 'turtle'],
    ['people.turtle', 'turtle'],
    ['people.nt', 'ntriples'],
    ['people.nq', 'nquads'],
    ['people.trig', 'trig'],
    ['go-basic.obo', 'obo'],
    ['GO-BASIC.OBO', 'obo'],
    ['https://example.org/data/go.obo?ref=main#top', 'obo'],
    ['nested/dir/v2.People.TTL', 'turtle'],
  ] satisfies [string, FormatId][])('%s → %s', (filename, format) => {
    expect(detectFormat('', filename)).toBe(format);
  });

  it('trusts the extension over the content', () => {
    expect(detectFormat('{"nodes": []}', 'data.ttl')).toBe('turtle');
  });

  it('falls back to content sniffing for unknown extensions', () => {
    expect(detectFormat(fixture('go-mini.obo'), 'go.txt')).toBe('obo');
    expect(detectFormat(fixture('people.ttl'), 'people.owl')).toBe('turtle');
  });

  it('knows every format id', () => {
    expect(Object.keys(FORMAT_EXTENSIONS).sort()).toEqual(
      ['json', 'nquads', 'ntriples', 'obo', 'trig', 'turtle'].sort(),
    );
  });
});

describe('detectFormat by content', () => {
  it.each([
    ['kgdiff.json', 'json'],
    ['cytoscape-elements.json', 'json'],
    ['go-mini.obo', 'obo'],
    ['people.ttl', 'turtle'],
    ['go-mini.ttl', 'turtle'],
    ['people.nt', 'ntriples'],
    ['people.nq', 'nquads'],
    ['people.trig', 'trig'],
  ] satisfies [string, FormatId][])('%s → %s', (name, format) => {
    expect(detectFormat(fixture(name))).toBe(format);
  });

  it('recognises JSON after a byte order mark and whitespace', () => {
    expect(detectFormat('﻿ \n {"nodes": []}')).toBe('json');
    expect(detectFormat('[ {"data": {"id": "a"}} ]')).toBe('json');
    expect(detectFormat('[]')).toBe('json');
  });

  it('reads a leading [ as a Turtle blank node when no JSON value follows', () => {
    expect(detectFormat('[] a <http://example.org/Thing> .')).toBe('turtle');
    expect(detectFormat('[ <http://example.org/p> "x" ] .')).toBe('turtle');
  });

  it('recognises OBO by its header or by a stanza line', () => {
    expect(detectFormat('format-version: 1.4\n')).toBe('obo');
    expect(detectFormat('! comment\n[Term]\nid: X:1\n')).toBe('obo');
    expect(detectFormat('[Typedef]\r\nid: part_of\r\n')).toBe('obo');
  });

  it('recognises Turtle by @prefix / PREFIX / @base directives, in any case', () => {
    expect(detectFormat('@prefix ex: <http://ex.org/> .\nex:a ex:b ex:c .')).toBe('turtle');
    expect(detectFormat('PREFIX ex: <http://ex.org/>\nex:a ex:b ex:c .')).toBe('turtle');
    expect(detectFormat('prefix ex: <http://ex.org/>\nex:a ex:b ex:c .')).toBe('turtle');
    expect(detectFormat('@base <http://ex.org/> .\n<a> <b> <c> .')).toBe('turtle');
  });

  it('recognises Turtle without directives when statements are not line-based', () => {
    expect(detectFormat('<http://a> <http://b> "x" ;\n  <http://c> <http://d> .')).toBe('turtle');
    expect(detectFormat('ex:a ex:b ex:c .')).toBe('turtle');
  });

  it('tells N-Triples from N-Quads by the number of terms per statement', () => {
    const triple = '<http://a> <http://b> "x"@en-GB .';
    const quad = '<http://a> <http://b> _:c <http://g> .';
    expect(detectFormat(`# header\n${triple}\n\n${triple}\n`)).toBe('ntriples');
    expect(detectFormat(`${triple}\n${quad}\n`)).toBe('nquads');
    expect(detectFormat('<http://a> <http://b> "a \\"quoted\\" text"^^<http://t> .')).toBe(
      'ntriples',
    );
  });

  it('tells TriG from Turtle by a graph block, ignoring braces in strings, IRIs and comments', () => {
    expect(detectFormat('@prefix ex: <http://ex.org/> .\nex:g { ex:a ex:b ex:c . }')).toBe('trig');
    expect(detectFormat('PREFIX ex: <http://ex.org/>\nGRAPH ex:g {\n ex:a ex:b ex:c .\n}')).toBe(
      'trig',
    );
    expect(
      detectFormat(
        '@prefix ex: <http://ex.org/> .\n# {comment}\nex:a ex:b "{text}", """{long\n}""" .',
      ),
    ).toBe('turtle');
    expect(
      detectFormat('@prefix ex: <http://ex.org/> .\nex:a ex:b ex:c {| ex:since 2020 |} .'),
    ).toBe('turtle');
  });

  it('treats empty and comment-only input as an empty Turtle graph', () => {
    expect(detectFormat('')).toBe('turtle');
    expect(detectFormat('  \n# nothing here\n')).toBe('turtle');
    expect(parseGraph('').graph).toEqual({ nodes: [], edges: [] });
  });

  it('only samples the start of large N-Triples files', () => {
    const line = '<http://example.org/s> <http://example.org/p> "a value long enough to fill" .\n';
    const big = line.repeat(5000);
    expect(big.length).toBeGreaterThan(64 * 1024);
    expect(detectFormat(big)).toBe('ntriples');
  });
});

describe('detectFormat errors', () => {
  it('rejects RDF/XML and OWL/XML with a conversion hint', () => {
    const error = catchError(() =>
      detectFormat('<?xml version="1.0"?>\n<rdf:RDF xmlns:rdf="…"></rdf:RDF>', 'go.owl'),
    );
    expect(error.code).toBe('invalid-input');
    expect(error.message).toMatch(/RDF\/XML.*not supported.*"go\.owl".*Turtle/s);
    expect(catchError(() => detectFormat('<rdf:RDF\n xmlns:rdf="x">')).message).toMatch(/RDF\/XML/);
    expect(catchError(() => detectFormat('<Ontology xmlns="x">')).message).toMatch(/OWL\/XML/);
  });

  it('rejects OWL Functional and Manchester syntax', () => {
    expect(
      catchError(() => detectFormat('Prefix(:=<http://ex.org/>)\nOntology(<http://ex.org/o>)'))
        .message,
    ).toMatch(/OWL Functional Syntax is not supported/);
    expect(
      catchError(() => detectFormat('Prefix: : <http://ex.org/>\nOntology: <x>')).message,
    ).toMatch(/Manchester/);
  });

  it('asks for an explicit format when nothing matches', () => {
    const error = catchError(() => detectFormat('just some words', 'notes.txt'));
    expect(error.code).toBe('invalid-input');
    expect(error.message).toMatch(/Could not detect the format of "notes\.txt".*Pass `format`/);
    expect(error.details).toEqual({ filename: 'notes.txt' });
  });
});
