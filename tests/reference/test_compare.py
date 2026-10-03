import unittest

from compare import compare_report, failures, location, svrl_errors


class ComparisonTests(unittest.TestCase):
    def test_locations_keep_namespaces_and_occurrences(self):
        ns = {'rsm': 'urn:root', 'ram': 'urn:party'}
        rust = '/rsm:Invoice/ram:Party[2]/ram:Name'
        svrl = "/*:Invoice[namespace-uri()='urn:root'][1]/*:Party[namespace-uri()='urn:party'][2]/*:Name[namespace-uri()='urn:party'][1]"
        self.assertEqual(location(rust, ns), location(svrl, ns))
        self.assertNotEqual(location(rust, ns), location(rust.replace('[2]', '[1]'), ns))
        self.assertNotEqual(location(rust, ns), location(rust, {**ns, 'ram': 'urn:other'}))

    def test_multiple_occurrences_and_severity_are_not_collapsed(self):
        error = {'id': 'BR-1', 'flag': 'fatal', 'location': '/Invoice'}
        self.assertNotEqual(failures([error, error], {}), failures([error], {}))
        self.assertNotEqual(failures([error], {}), failures([{**error, 'flag': 'warning'}], {}))

    def test_successful_reports_mean_errors_and_empty_svrl_is_valid(self):
        start = '<svrl:schematron-output xmlns:svrl="http://purl.oclc.org/dsdl/svrl">'
        self.assertEqual(svrl_errors(start + '</svrl:schematron-output>'), [])
        text = start + '<svrl:successful-report location="/Invoice"/></svrl:schematron-output>'
        self.assertEqual(svrl_errors(text)[0]['id'], 'FX-NON-UTILISE')
        with self.assertRaises(ValueError):
            svrl_errors('<Invoice/>')

    def test_matching_errors_do_not_hide_wrong_verdict_or_incomplete_evaluation(self):
        svrl = '<svrl:schematron-output xmlns:svrl="http://purl.oclc.org/dsdl/svrl"><svrl:fired-rule/></svrl:schematron-output>'
        good = {'evalue': True, 'ok': True, 'non_conformes': 0, 'avertissements': 0,
                'regles_declenchees': 1, 'erreurs': []}
        self.assertIsNone(compare_report(good, svrl, {}))
        for change in [{'ok': False}, {'evalue': False}, {'regles_declenchees': 0},
                       {'non_evaluables': ['BR-1']}, {'non_compilees': ['BR-2']}]:
            self.assertIsNotNone(compare_report({**good, **change}, svrl, {}))


if __name__ == '__main__':
    unittest.main()
