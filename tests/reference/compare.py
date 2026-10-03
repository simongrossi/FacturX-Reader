#!/usr/bin/env python3
"""Comparaison du moteur de production à SaxonC-HE (SVRL) et libxml2 (XSD)."""
import argparse
import collections
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import urllib.request
import xml.etree.ElementTree as ET

from saxonche import PySaxonProcessor, PySaxonApiError
from decimal import Decimal

ROOT = Path(__file__).resolve().parents[2]
HERE = ROOT / 'tests/reference'
CACHE = HERE / 'cache'
OUT = HERE / 'output'
SCH = ROOT / 'src-tauri/schematron'
XSD = ROOT / 'src-tauri/xsd'
XS = '{http://www.w3.org/2001/XMLSchema}'
SVRL = '{http://purl.oclc.org/dsdl/svrl}'
NS = {prefix: 'urn:un:unece:uncefact:data:standard:' + name + ':100' for prefix, name in [
    ('rsm', 'CrossIndustryInvoice'), ('ram', 'ReusableAggregateBusinessInformationEntity'),
    ('udt', 'UnqualifiedDataType'), ('qdt', 'QualifiedDataType')]}
NS.update({'cbc': 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
           'cac': 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2'})
for prefix, uri in NS.items():
    ET.register_namespace(prefix, uri)
PROFILES = {
    'minimum': 'urn:factur-x.eu:1p0:minimum',
    'basicwl': 'urn:factur-x.eu:1p0:basicwl',
    'basic': 'urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic',
    'en16931': 'urn:cen.eu:en16931:2017',
    'extended': 'urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:extended',
}
CTC = 'urn:cen.eu:en16931:2017#conformant#urn.cpro.gouv.fr:1p0:extended-ctc-fr'


def run(args, **kwargs):
    return subprocess.run([str(x) for x in args], cwd=ROOT, check=True, **kwargs)


def sources(offline):
    manifest = json.loads((HERE / 'sources.json').read_text())
    for asset in manifest['assets']:
        path = CACHE / asset['path']
        if not path.exists():
            if offline:
                raise RuntimeError(f'Source absente hors ligne : {path}')
            print('Téléchargement :', asset['path'], flush=True)
            data = urllib.request.urlopen(asset['url'], timeout=60).read()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        if hashlib.sha256(path.read_bytes()).hexdigest() != asset['sha256']:
            raise RuntimeError(f'Empreinte incorrecte : {path}')
    # Les feuilles officielles françaises ne sont pertinentes que pour les règles embarquées.
    for name in ['EXTENDED-CTC-FR-CII', 'EXTENDED-CTC-FR-UBL',
                 'BR-FR-Flux2-Schematron-CII', 'BR-FR-Flux2-Schematron-UBL']:
        if (SCH / 'france' / (name + '.sch')).read_bytes() != (CACHE / 'france' / (name + '.sch')).read_bytes():
            raise RuntimeError(f'Les règles {name} diffèrent de la référence épinglée')
    return manifest


def compile_stylesheets(saxon):
    compiler = saxon.new_xslt30_processor()
    skeleton = compiler.compile_stylesheet(stylesheet_file=str(CACHE / 'skeleton/iso_svrl_for_xslt2.xsl'))
    styles = {}
    for key, name in [('FX-MINIMUM', 'MINIMUM'), ('FX-BASICWL', 'BASIC-WL'),
                      ('FX-BASIC', 'BASIC'), ('FX-EXTENDED', 'EXTENDED')]:
        folder = CACHE / 'compiled' / key
        folder.mkdir(parents=True, exist_ok=True)
        sch = SCH / 'factur-x' / f'FACTUR-X_{name}.sch'
        db = SCH / 'factur-x' / f'FACTUR-X_{name}_codedb.xml'
        # Pas de réécriture des expressions : le compilateur ISO exécute les règles originales.
        local_sch = folder / sch.name
        local_sch.write_bytes(sch.read_bytes())
        (folder / db.name).write_bytes(db.read_bytes())
        xsl = folder / 'validation.xsl'
        skeleton.transform_to_file(source_file=str(local_sch), output_file=str(xsl))
        styles[key] = xsl
    # Ce profil est identique, règles et listes de codes comprises : feuille officielle directe.
    for suffix in ['.sch', '_codedb.xml']:
        name = 'FACTUR-X_BASIC-WL' + suffix
        if (SCH / 'factur-x' / name).read_bytes() != (CACHE / 'factur-x' / name).read_bytes():
            raise RuntimeError('BASIC WL diffère de la référence officielle épinglée')
    styles['FX-BASICWL'] = CACHE / 'factur-x/FACTUR-X_BASIC-WL.xslt'
    for fmt in ['CII', 'UBL']:
        styles['EN-' + fmt] = CACHE / 'en16931' / (fmt + '.xslt')
        styles['CTC-' + fmt] = CACHE / 'france' / ('EXTENDED-CTC-FR-' + fmt + '.xslt')
        styles['BR-' + fmt] = CACHE / 'france' / ('BR-FR-Flux2-Schematron-' + fmt + '.xslt')
    for key, source in list(styles.items()):
        print('Compilation SaxonC-HE :', key, flush=True)
        styles[key] = compiler.compile_stylesheet(stylesheet_file=str(source))
    return styles


def local(tag):
    return tag.rsplit('}', 1)[-1]


def profile(root):
    if local(root.tag) == 'CrossIndustryInvoice':
        return root.findtext('rsm:ExchangedDocumentContext/ram:GuidelineSpecifiedDocumentContextParameter/ram:ID', '', NS).lower()
    return root.findtext('cbc:CustomizationID', '', NS).lower()


def group(root):
    fmt = 'CII' if local(root.tag) == 'CrossIndustryInvoice' else 'UBL'
    p = profile(root)
    if p == CTC:
        return 'CTC-' + fmt
    for name in ['minimum', 'basicwl', 'basic', 'extended']:
        if p == PROFILES[name]:
            return 'FX-' + name.upper()
    return 'EN-' + fmt


def schema(root):
    if local(root.tag) != 'CrossIndustryInvoice':
        return XSD / 'ubl-2.1/maindoc' / ('UBL-' + local(root.tag) + '-2.1.xsd')
    p = profile(root)
    for name, uri in PROFILES.items():
        if p == uri:
            return XSD / 'factur-x' / name / {
                'minimum': 'Factur-X_1.09.2_MINIMUM.xsd', 'basicwl': 'Factur-X_1.09.2_BASICWL.xsd',
                'basic': 'Factur-X_1.09.2_BASIC.xsd', 'en16931': 'Factur-X_1.09.2_EN16931.xsd',
                'extended': 'Factur-X_1.09.2_EXTENDED.xsd'}[name]
    return XSD / 'cii-d22b/CrossIndustryInvoice_100pD22B.xsd'


def french_scope(root):
    if group(root).startswith('CTC-'):
        return True
    if local(root.tag) == 'CrossIndustryInvoice':
        paths = ['.//ram:SellerTradeParty/ram:PostalTradeAddress/ram:CountryID', './/ram:BuyerTradeParty/ram:PostalTradeAddress/ram:CountryID']
    else:
        paths = ['cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cac:Country/cbc:IdentificationCode',
                 'cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cac:Country/cbc:IdentificationCode']
    return all(root.findtext(path, '', NS).strip().upper() == 'FR' for path in paths)


def variants(root):
    """Altérations isolées ; le document évalué est identique pour les trois moteurs."""
    cii = local(root.tag) == 'CrossIndustryInvoice'
    paths = {
        'numero-vide': ('rsm:ExchangedDocument/ram:ID' if cii else 'cbc:ID', ''),
        'numero-long': ('rsm:ExchangedDocument/ram:ID' if cii else 'cbc:ID', 'X' * 201),
        'devise-inconnue': ('.//ram:InvoiceCurrencyCode' if cii else 'cbc:DocumentCurrencyCode', 'ZZZ'),
        'pays-inconnu': ('.//ram:SellerTradeParty/ram:PostalTradeAddress/ram:CountryID' if cii else 'cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cac:Country/cbc:IdentificationCode', 'ZZ'),
        'vendeur-sans-nom': ('.//ram:SellerTradeParty/ram:Name' if cii else 'cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName', None),
        'date-absente': ('rsm:ExchangedDocument/ram:IssueDateTime' if cii else 'cbc:IssueDate', None),
        'unite-inconnue': ('.//ram:BilledQuantity' if cii else './/cbc:InvoicedQuantity', ('unitCode', 'ZZZ')),
        'tva-inconnue': ('.//ram:ApplicableTradeTax/ram:CategoryCode' if cii else './/cac:ClassifiedTaxCategory/cbc:ID', 'ZZZ'),
        'total-faux': ('.//ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:GrandTotalAmount' if cii else 'cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount', Decimal('1.00')),
        'precision-total': ('.//ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:GrandTotalAmount' if cii else 'cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount', Decimal('0.001')),
        'attribut-inconnu': ('rsm:ExchangedDocument/ram:ID' if cii else 'cbc:ID', ('inconnu', 'x')),
    }
    for name, (path, value) in paths.items():
        tree = copy.deepcopy(root)
        node = tree.find(path, NS)
        if node is None:
            continue
        if value is None:
            next(parent for parent in tree.iter() if node in list(parent)).remove(node)
        elif isinstance(value, tuple):
            node.set(*value)
        elif isinstance(value, Decimal):
            node.text = str(Decimal(node.text.strip()) + value)
        else:
            node.text = value
        yield name, tree, True
    tree = copy.deepcopy(root)
    ET.SubElement(tree, '{urn:reference:test}Inconnu').text = 'x'
    yield 'element-inconnu', tree, True
    tree = copy.deepcopy(root)
    children = list(tree)
    tree.remove(children[0])
    tree.insert(1, children[0])
    yield 'ordre-invalide', tree, True
    # Typage XSD : la référence XSLT peut s'arrêter, ce n'est pas un verdict conforme.
    tree = copy.deepcopy(root)
    node = tree.find('.//ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:GrandTotalAmount' if cii else 'cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount', NS)
    if node is not None:
        node.text = 'pas-un-montant'
        yield 'montant-non-numerique', tree, False
    for name, value in [('montant-exposant', '1e2'), ('montant-double-signe', '++12.'),
                        ('montant-virgule', '12,50'), ('montant-fraction-vide', '12.')]:
        tree = copy.deepcopy(root)
        node = tree.find('.//ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:GrandTotalAmount' if cii else 'cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount', NS)
        if node is not None:
            node.text = value
            yield name, tree, False
    tree = copy.deepcopy(root)
    node = tree.find('.//ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:GrandTotalAmount' if cii else 'cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount', NS)
    if node is not None:
        node.text = None
        ET.SubElement(node, '{urn:reference:test}Montant').text = '12.50'
        yield 'montant-avec-enfant', tree, False


def corpus(quick):
    folder = OUT / 'corpus'
    folder.mkdir(parents=True, exist_ok=True)
    originals = sorted((CACHE / 'examples').rglob('*.xml'))
    if quick:
        originals = [SCH / 'france/exemples' / name for name in [
            'Facture_F20260023-LE_FOURNISSEUR-POUR-LE_CLIENT_BASICWL_FX_CII_Commentee.xml',
            'UC10_F202600004_MULTI-VENDEUR_EXTENDED-CTC-FR_CII_Commentee.xml',
            'UC10_F202600004_MULTI-VENDEUR_EXTENDED-CTC-FR_UBL_Commentee.xml']]
    originals += sorted((HERE / 'fixtures').glob('*.xml'))
    originals += [SCH / 'exemples/CII_example3.xml', SCH / 'exemples/ubl-tc434-example3.xml',
                  SCH / 'tests-officiels/testfiles/CreditNote-Min_content_with_VAT.xml']
    cases = []
    for n, path in enumerate(originals):
        data = path.read_bytes()
        root = ET.fromstring(data)
        for variant, tree, check_sch in [('original', root, True), *variants(root)]:
            case_path = folder / f'{n:03d}-{path.stem}-{variant}.xml'
            case_path.write_bytes(data if variant == 'original' else ET.tostring(tree, encoding='utf-8', xml_declaration=True))
            cases.append({'id': case_path.stem, 'path': str(case_path), 'format': 'CII' if local(tree.tag) == 'CrossIndustryInvoice' else 'UBL',
                          'group': group(tree), 'schema': str(schema(tree)), 'br_fr': french_scope(tree),
                          'variant': variant, 'schematron': check_sch, 'source': str(path.relative_to(ROOT)),
                          'sha256': hashlib.sha256(case_path.read_bytes()).hexdigest()})
    return cases


def location(path, namespaces):
    """Compare des chemins développés (URI, nom local, occurrence), sans perdre les indices."""
    expanded = {}
    def replace(match):
        key = 'expanded' + str(len(expanded))
        expanded[key] = (match[2], match[1])
        return key
    path = re.sub(r"\*:([\w.-]+)\[namespace-uri\(\)='([^']*)'\]", replace, path)
    result = []
    for part in path.strip('/').split('/'):
        match = re.fullmatch(r'([\w:.-]+)(?:\[(\d+)\])?', part)
        if not match:
            raise ValueError('Chemin non reconnu : ' + path)
        name, index = match.groups()
        if name in expanded:
            uri, name = expanded[name]
        elif ':' in name:
            prefix, name = name.split(':', 1)
            uri = namespaces[prefix]
        else:
            uri = ''
        result.append((uri, name, int(index or 1)))
    return tuple(result)


def namespaces(path):
    return dict(value for _, value in ET.iterparse(path, events=['start-ns']))


def failures(errors, ns):
    return collections.Counter((e['id'], e.get('flag') or 'fatal', location(e['location'], ns)) for e in errors)


def svrl_errors(text):
    root = ET.fromstring(text)
    if root.tag != SVRL + 'schematron-output':
        raise ValueError('La référence n’a pas produit de SVRL')
    errors = []
    for node in root.iter():
        if node.tag in [SVRL + 'failed-assert', SVRL + 'successful-report']:
            errors.append({'id': node.get('id') or ('FX-NON-UTILISE' if node.tag == SVRL + 'successful-report' else ''),
                           'flag': node.get('flag') or 'fatal', 'location': node.get('location')})
    return errors


def compare_report(report, svrl, ns):
    expected = failures(svrl_errors(svrl), ns)
    actual = failures(report.get('erreurs', []), ns)
    incomplete = report.get('non_evaluables', []) or report.get('non_compilees', [])
    fatals = sum(count for (_, flag, _), count in expected.items() if flag == 'fatal')
    warnings = sum(expected.values()) - fatals
    fired = len(ET.fromstring(svrl).findall(SVRL + 'fired-rule'))
    counters = {'ok': fatals == 0, 'non_conformes': fatals,
                'avertissements': warnings, 'regles_declenchees': fired}
    wrong_counts = {key: {'rust': report.get(key), 'reference': value}
                    for key, value in counters.items() if report.get(key) != value}
    if report.get('evalue') is not True or incomplete or actual != expected or wrong_counts:
        return {'missing': list((expected - actual).elements()),
                'extra': list((actual - expected).elements()), 'incomplete': incomplete,
                'evaluated': report.get('evalue'), 'counters': wrong_counts}
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--quick', action='store_true', help='Exemples locaux et fixtures, au lieu des 41 exemples France_RFE')
    args = parser.parse_args()
    os.chdir(ROOT)
    # Évite qu'un rapport d'une exécution précédente soit pris pour le résultat d'un échec.
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True, exist_ok=True)
    if not shutil.which('xmllint'):
        raise RuntimeError('xmllint requis (libxml2)')
    manifest = sources(args.offline)
    saxon = PySaxonProcessor(license=False)
    styles = compile_stylesheets(saxon)
    cases = corpus(args.quick)
    (OUT / 'manifest.json').write_text(json.dumps(cases, ensure_ascii=False, indent=2) + '\n')
    print(f'{len(cases)} documents : exécution du moteur Rust', flush=True)
    run(['cargo', 'build', '--locked', '--manifest-path', ROOT / 'src-tauri/Cargo.toml',
         '--features', 'reference-validation', '--example', 'validate_reference'])
    proc = run([ROOT / 'src-tauri/target/debug/examples/validate_reference'],
               input=json.dumps(cases), text=True, capture_output=True)
    rust = json.loads(proc.stdout)
    if len(rust) != len(cases):
        raise RuntimeError('Nombre de résultats Rust incorrect')
    results, differences = [], []
    counts = collections.Counter()
    coverage = collections.defaultdict(set)
    by_schema = collections.defaultdict(collections.Counter)
    for n, (case, actual) in enumerate(zip(cases, rust)):
        record = {'case': case, 'rust': actual, 'reference': {}}
        reference = subprocess.run(['xmllint', '--nonet', '--noout', '--schema', case['schema'], case['path']], text=True, capture_output=True)
        if reference.returncode not in [0, 3]:
            raise RuntimeError(f'libxml2 indisponible pour {case["id"]} : {reference.stderr}')
        ref_ok = reference.returncode == 0
        record['reference']['xsd'] = {'ok': ref_ok, 'diagnostic': reference.stderr}
        if actual['xsd'].get('evalue') is not True or actual['xsd']['ok'] != ref_ok:
            differences.append({'case': case['id'], 'validator': 'xsd', 'rust': actual['xsd'], 'reference_ok': ref_ok})
        else:
            counts['xsd_agreements'] += 1
        counts['xsd_valid' if ref_ok else 'xsd_invalid'] += 1
        by_schema[Path(case['schema']).name]['valid' if ref_ok else 'invalid'] += 1
        if case['variant'] == 'original' and not ref_ok:
            differences.append({'case': case['id'], 'validator': 'corpus', 'reason': 'Le document de départ doit être valide XSD'})
        if case['variant'] in ['montant-non-numerique', 'montant-exposant', 'montant-double-signe', 'montant-virgule', 'montant-avec-enfant'] and ref_ok:
            differences.append({'case': case['id'], 'validator': 'corpus', 'reason': 'Le montant altéré doit être invalide XSD'})
        if case['variant'] == 'montant-fraction-vide' and not ref_ok:
            differences.append({'case': case['id'], 'validator': 'corpus', 'reason': '12. est un décimal XSD valide'})
        if case['schematron']:
            groups = [(case['group'], actual['schematron'])]
            if case['br_fr']:
                br = actual['schematron'].get('br_fr', {})
                groups.append(('BR-' + case['format'], {'evalue': bool(br) and actual['schematron'].get('evalue'), **br}))
            elif 'br_fr' in actual['schematron']:
                differences.append({'case': case['id'], 'validator': 'scope', 'reason': 'BR-FR appliqué hors du périmètre attendu'})
            for key, report in groups:
                try:
                    ref = {'svrl': styles[key].transform_to_string(source_file=case['path'])}
                except PySaxonApiError as error:
                    ref = {'error': str(error)}
                record['reference'][key] = ref
                if 'error' in ref:
                    differences.append({'case': case['id'], 'validator': key, 'reference_error': ref})
                    counts['reference_errors'] += 1
                    continue
                ns = namespaces(case['path'])
                expected = failures(svrl_errors(ref['svrl']), ns)
                difference = compare_report(report, ref['svrl'], ns)
                if difference:
                    differences.append({'case': case['id'], 'validator': key,
                                        **difference})
                else:
                    counts['schematron_agreements'] += 1
                counts[key + '_checks'] += 1
                coverage[key].update(e[0] for e in expected)
        results.append(record)
        if (n + 1) % 25 == 0:
            print(f'{n + 1}/{len(cases)} documents comparés, {len(differences)} écarts', flush=True)
    required = {'FX-MINIMUM', 'FX-BASICWL', 'FX-BASIC', 'FX-EXTENDED', 'CTC-CII', 'CTC-UBL', 'BR-CII', 'BR-UBL', 'EN-CII', 'EN-UBL'}
    if set(coverage) != required or any(not coverage[key] for key in required) or len(by_schema) != 8:
        differences.append({'validator': 'coverage', 'reason': 'Toutes les familles doivent être évaluées avec des erreurs déclenchées, et les huit schémas exercés'})
    summary = {'documents': len(cases), 'originals': sum(c['variant'] == 'original' for c in cases),
               'quick': args.quick, 'counts': dict(counts), 'differences': differences,
               'rules_triggered': {k: sorted(v) for k, v in sorted(coverage.items())},
               'xsd_by_schema': {k: dict(v) for k, v in sorted(by_schema.items())},
               'reference_versions': {'saxonc': saxon.version,
                                      'libxml2': subprocess.run(['xmllint', '--version'], capture_output=True, text=True).stderr.splitlines()[0]},
               'source_manifest_sha256': hashlib.sha256((HERE / 'sources.json').read_bytes()).hexdigest(),
               'engine_sources_sha256': {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
                                        for name in ['src-tauri/src/schematron.rs', 'src-tauri/src/xsd.rs', 'src-tauri/Cargo.lock']},
               'sources': {k: v for k, v in manifest.items() if k != 'assets'}}
    (OUT / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n')
    (OUT / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in summary.items() if k not in ['differences', 'rules_triggered']}, ensure_ascii=False, indent=2))
    print(f'{len(differences)} écarts ; détails : {OUT / "summary.json"}')
    return 1 if differences else 0


if __name__ == '__main__':
    sys.exit(main())
