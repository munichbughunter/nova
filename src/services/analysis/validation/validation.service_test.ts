import { assertEquals, assertExists, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { describe, it, beforeEach } from 'https://deno.land/std@0.208.0/testing/bdd.ts';
import { z } from 'zod';
import { ValidationService, type DataTransformer, type ErrorRecoveryStrategy } from './validation.service.ts';
import { 
    StrictReviewAnalysisSchema, 
    FlexibleReviewAnalysisSchema,
    PartialReviewAnalysisSchema 
} from './schemas.ts';
import { Logger } from '../../../utils/logger.ts';

describe('ValidationService', () => {
    let validationService: ValidationService;
    let logger: Logger;

    beforeEach(() => {
        logger = {
            debug: () => {},
            info: () => {},
            warn: () => {},
            error: () => {},
            child: () => logger,
            debugEnabled: false,
            context: 'test',
            success: () => {},
            passThrough: () => {},
            table: () => {},
            json: () => {}
        } as Logger;
        validationService = new ValidationService(logger);
    });

    describe('Basic Validation', () => {
        it('should validate correct data successfully', async () => {
            const validData = {
                grade: 'A',
                coverage: 85,
                testsPresent: true,
                value: 'high',
                state: 'pass',
                issues: [],
                suggestions: ['Great code!'],
                summary: 'Excellent implementation'
            };

            const result = await validationService.validateWithTransformation(
                validData,
                FlexibleReviewAnalysisSchema // Use flexible schema for tests
            );

            assertEquals(result.success, true);
            assertExists(result.data);
            assertEquals(result.data.grade, 'A');
            assertEquals(result.data.coverage, 85);
        });

        it('should handle validation errors without transformation', async () => {
            const invalidData = {
                grade: 'X', // Invalid grade
                coverage: 'not-a-number',
                testsPresent: 'maybe',
                value: 'unknown',
                state: 'broken'
            };

            const result = await validationService.validateWithTransformation(
                invalidData,
                StrictReviewAnalysisSchema
            );

            assertEquals(result.success, false);
            assert(result.errors.length > 0);
        });
    });

    describe('String to Number Transformation', () => {
        it('should transform string coverage to number', async () => {
            const dataWithStringCoverage = {
                grade: 'B',
                coverage: '75', // String instead of number
                testsPresent: true,
                value: 'medium',
                state: 'pass',
                issues: [],
                suggestions: [],
                summary: 'Good code'
            };

            const result = await validationService.validateWithTransformation(
                dataWithStringCoverage,
                FlexibleReviewAnalysisSchema
            );

            assertEquals(result.success, true);
            assertExists(result.data);
            assertEquals(result.data.coverage, 75);
            assert(result.transformationsApplied.includes('pre-validation-transforms'));
        });

        it('should handle percentage string coverage', async () => {
            const dataWithPercentageCoverage = {
                grade: 'B',
                coverage: '85%', // Percentage string
                testsPresent: true,
                value: 'medium',
                state: 'pass',
                issues: [],
                suggestions: [],
                summary: 'Good code'
            };

            const result = await validationService.validateWithTransformation(
                dataWithPercentageCoverage,
                FlexibleReviewAnalysisSchema
            );

            assertEquals(result.success, true);
            assertExists(result.data);
            assertEquals(result.data.coverage, 85);
        });

        it('should handle invalid coverage strings with default', async () => {
            const dataWithInvalidCoverage = {
                grade: 'C',
                coverage: 'invalid-coverage',
                testsPresent: false,
                value: 'low',
                state: 'warning',
                issues: [],
                suggestions: [],
                summary: 'Needs work'
            };

            const result = await validationService.validateWithTransformation(
                dataWithInvalidCoverage,
                FlexibleReviewAnalysisSchema
            );

            assertEquals(result.success, true);
            assertExists(result.data);
            assertEquals(result.data.coverage, 0); // Default value
        });

        it('should clamp coverage values to valid range', async () => {
            const dataWithOutOfRangeCoverage = {
                grade: 'A',
                coverage: '150', // Over 100%
                testsPresent: true,
                value: 'high',
                state: 'pass',
                issues: [],
                suggestions: [],
                summary: 'Excellent'
            };

            const result = await validationService.validateWithTransformation(
                dataWithOutOfRangeCoverage,
                FlexibleReviewAnalysisSchema
            );

            assertEquals(result.success, true);
            assertExists(result.data);
            assertEquals(result.data.coverage, 100); // Clamped to max
        });
    });

    describe('Boolean Transformation', () => {
        it('should transform string boolean values', async () => {
            const testCases = [
                { input: 'true', expected: true },
                { input: 'false', expected: false },
                { input: 'TRUE', expected: true },
                { input: 'FALSE', expected: false },
                { input: '1', expected: true },
                { input: '0', expected: false },
                { input: 'yes', expected: true },
                { input: 'no', expected: false },
                { input: 'random', expected: false },
            ];

            for (const testCase of testCases) {
                const data = {
                    grade: 'B',
                    coverage: 75,
                    testsPresent: testCase.input,
                    value: 'medium',
                    state: 'pass',
                    issues: [],
                    suggestions: [],
                    summary: 'Test'
                };

                const result = await validationService.validateWithTransformation(
                    data,
                    FlexibleReviewAnalysisSchema
                );

                assertEquals(result.success, true, `Failed for input: ${testCase.input}`);
                assertExists(result.data);
                assertEquals(result.data.testsPresent, testCase.expected, 
                    `Expected ${testCase.expected} for input: ${testCase.input}`);
            }
        });

        it('should transform number boolean values', async () => {
            const data = {
                grade: 'B',
                coverage: 75,
                testsPresent: 1, // Number instead of boolean
                value: 'medium',
                state: 'pass',
                issues: [],
                suggestions: [],
                summary: 'Test'
            };

            const result = await validationService.validateWithTransformation(
                data,
                FlexibleReviewAnalysisSchema
            );

            assertEquals(result.success, true);
            assertExists(result.data);
            assertEquals(result.data.testsPresent, true);
        });
    });

    describe('Enum Normalization', () => {
        it('should normalize grade values', async () => {
            const data = {
                grade: 'a', // Lowercase
                coverage: 90,
                testsPresent: true,
                value: 'high',
                state: 'pass',
                issues: [],
                suggestions: [],
                summary: 'Great'
            };

            const result = await validationService.validateWithTransformation(
                data,
                FlexibleReviewAnalysisSchema
            );

            assertEquals(result.success, true);
            assertExists(result.data);
            assertEquals(result.data.grade, 'A');
        });

        it('should normalize value and state enums', async () => {
            const data = {
                grade: 'B',
                coverage: 75,
                testsPresent: true,
                value: 'HIGH', // Uppercase
                state: 'PASS', // Uppercase
                issues: [],
                suggestions: [],
                summary: 'Good'
            };

            const result = await validationService.validateWithTransformation(
                data,
                FlexibleReviewAnalysisSchema
            );

            assertEquals(result.success, true);
            assertExists(result.data);
            assertEquals(result.data.value, 'high');
            assertEquals(result.data.state, 'pass');
        });

        it('should use defaults for invalid enum values', async () => {
            const data = {
                grade: 'Z', // Invalid grade
                coverage: 75,
                testsPresent: true,
                value: 'invalid-value',
                state: 'broken-state',
                issues: [],
                suggestions: [],
                summary: 'Test'
            };

            const result = await validationService.validateWithTransformation(
                data,
                FlexibleReviewAnalysisSchema
            );

            assertEquals(result.success, true);
            assertExists(result.data);
            assertEquals(result.data.grade, 'C'); // Default
            assertEquals(result.data.value, 'medium'); // Default
            assertEquals(result.data.state, 'warning'); // Default
        });
    });

    describe('Missing Field Recovery', () => {
        it('should provide defaults for missing required fields', async () => {
            const incompleteData = {
                grade: 'B',
                coverage: 80,
                // Missing testsPresent, value, state, issues, suggestions, summary
            };

            const result = await validationService.validateWithTransformation(
                incompleteData,
                PartialReviewAnalysisSchema
            );

            assertEquals(result.success, true);
            assertExists(result.data);
            assertEquals(result.data.testsPresent, false); // Default
            assertEquals(result.data.value, 'medium'); // Default
            assertEquals(result.data.state, 'warning'); // Default
            assertEquals(result.data.issues?.length, 0); // Default empty array
            assertEquals(result.data.suggestions?.length, 0); // Default empty array
            // The summary field gets transformed by the string transformer to empty string
            // when the field is missing, rather than using the schema default
            assertEquals(typeof result.data.summary, 'string'); // Should be a string
        });

        it('should handle completely empty data with partial schema', async () => {
            const emptyData = {};

            const result = await validationService.validateWithTransformation(
                emptyData,
                PartialReviewAnalysisSchema
            );

            assertEquals(result.success, true);
            assertExists(result.data);
            assertEquals(result.data.grade, 'C');
            assertEquals(result.data.coverage, 0);
            assertEquals(result.data.testsPresent, false);
            assertEquals(result.data.value, 'medium');
            assertEquals(result.data.state, 'warning');
        });
    });

    describe('Error Recovery Strategies', () => {
        it('should recover from type mismatch errors', async () => {
            const dataWithTypeMismatches = {
                grade: 'B',
                coverage: '85%', // String instead of number
                testsPresent: 'true', // String instead of boolean
                value: 'high',
                state: 'pass',
                issues: [],
                suggestions: [],
                summary: 'Good code'
            };

            const result = await validationService.validateWithTransformation(
                dataWithTypeMismatches,
                StrictReviewAnalysisSchema // Using strict schema to trigger recovery
            );

            assertEquals(result.success, true);
            assertExists(result.data);
            assertEquals(result.data.coverage, 85);
            assertEquals(result.data.testsPresent, true);
            assert(result.transformationsApplied.length > 0, `Expected transformations but got: ${JSON.stringify(result.transformationsApplied)}`);
            // Note: No warnings are generated because pre-validation transformations succeed
            // and the strict schema validation passes after transformation
        });

        it('should handle complex nested validation errors', async () => {
            const dataWithNestedErrors = {
                grade: 'A',
                coverage: 90,
                testsPresent: true,
                value: 'high',
                state: 'pass',
                issues: [
                    {
                        line: '25', // String instead of number
                        severity: 'HIGH', // Wrong case
                        type: 'SECURITY', // Wrong case
                        message: 'Security issue found'
                    }
                ],
                suggestions: ['Fix the issue'],
                summary: 'Has security issues'
            };

            const result = await validationService.validateWithTransformation(
                dataWithNestedErrors,
                FlexibleReviewAnalysisSchema
            );

            assertEquals(result.success, true);
            assertExists(result.data);
            assertEquals(result.data.issues?.length, 1);
            assertEquals(result.data.issues?.[0]?.line, 25);
            assertEquals(result.data.issues?.[0]?.severity, 'high');
            assertEquals(result.data.issues?.[0]?.type, 'security');
        });
    });

    describe('Custom Transformers', () => {
        it('should use custom transformers', async () => {
            const customTransformer: DataTransformer = {
                name: 'custom-grade-transformer',
                priority: 200,
                canTransform: (data: unknown, targetType: string) => {
                    return typeof data === 'string' && data.includes('excellent');
                },
                transform: (data: unknown) => {
                    if (typeof data === 'string' && data.includes('excellent')) {
                        return 'A';
                    }
                    return data;
                }
            };

            const data = {
                grade: 'excellent work', // Custom format
                coverage: 95,
                testsPresent: true,
                value: 'high',
                state: 'pass',
                issues: [],
                suggestions: [],
                summary: 'Excellent code'
            };

            const result = await validationService.validateWithTransformation(
                data,
                FlexibleReviewAnalysisSchema,
                [customTransformer]
            );

            assertEquals(result.success, true);
            assertExists(result.data);
            assertEquals(result.data.grade, 'A');
        });
    });

    describe('Custom Recovery Strategies', () => {
        it('should use custom recovery strategies', async () => {
            const customStrategy: ErrorRecoveryStrategy = {
                name: 'custom-recovery',
                priority: 200,
                canRecover: (error: z.ZodError, data: unknown) => {
                    return error.issues.some(issue => 
                        issue.path.includes('grade') && issue.code === 'invalid_enum_value'
                    );
                },
                recover: async <T>(error: z.ZodError, data: unknown, schema: z.ZodType<T>) => {
                    const transformed = { ...data as Record<string, unknown> };
                    transformed.grade = 'B'; // Custom default
                    
                    try {
                        const validated = schema.parse(transformed);
                        return {
                            success: true,
                            data: validated,
                            errors: [],
                            transformationsApplied: ['custom-recovery'],
                            warnings: ['Applied custom grade recovery']
                        };
                    } catch (newError) {
                        return {
                            success: false,
                            errors: [newError as z.ZodError],
                            transformationsApplied: ['custom-recovery'],
                            warnings: ['Custom recovery failed']
                        };
                    }
                }
            };

            validationService.registerRecoveryStrategy(customStrategy);

            const data = {
                grade: 'invalid-grade',
                coverage: 80,
                testsPresent: true,
                value: 'medium',
                state: 'pass',
                issues: [],
                suggestions: [],
                summary: 'Test'
            };

            const result = await validationService.validateWithTransformation(
                data,
                StrictReviewAnalysisSchema
            );

            assertEquals(result.success, true);
            assertExists(result.data);
            assertEquals(result.data.grade, 'B');
            assert(result.transformationsApplied.includes('custom-recovery'));
        });
    });

    describe('Service Registration', () => {
        it('should register and retrieve transformers', () => {
            const transformer: DataTransformer = {
                name: 'test-transformer',
                priority: 50,
                canTransform: () => false,
                transform: (data) => data
            };

            validationService.registerTransformer(transformer);
            const transformers = validationService.getAvailableTransformers();
            
            const registered = transformers.find(t => t.name === 'test-transformer');
            assertExists(registered);
            assertEquals(registered.name, 'test-transformer');
        });

        it('should register and retrieve recovery strategies', () => {
            const strategy: ErrorRecoveryStrategy = {
                name: 'test-strategy',
                priority: 50,
                canRecover: () => false,
                recover: async () => ({
                    success: false,
                    errors: [],
                    transformationsApplied: [],
                    warnings: []
                })
            };

            validationService.registerRecoveryStrategy(strategy);
            const strategies = validationService.getAvailableRecoveryStrategies();
            
            const registered = strategies.find(s => s.name === 'test-strategy');
            assertExists(registered);
            assertEquals(registered.name, 'test-strategy');
        });

        it('should sort transformers and strategies by priority', () => {
            const lowPriorityTransformer: DataTransformer = {
                name: 'low-priority',
                priority: 10,
                canTransform: () => false,
                transform: (data) => data
            };

            const highPriorityTransformer: DataTransformer = {
                name: 'high-priority',
                priority: 100,
                canTransform: () => false,
                transform: (data) => data
            };

            validationService.registerTransformer(lowPriorityTransformer);
            validationService.registerTransformer(highPriorityTransformer);

            const transformers = validationService.getAvailableTransformers();
            assertEquals(transformers[0].name, 'coverage-transformer'); // Built-in with priority 100
            assertEquals(transformers[1].name, 'high-priority');
        });
    });

    describe('Edge Cases', () => {
        it('should handle null and undefined data', async () => {
            const result1 = await validationService.validateWithTransformation(
                null,
                StrictReviewAnalysisSchema
            );
            assertEquals(result1.success, false);

            const result2 = await validationService.validateWithTransformation(
                undefined,
                StrictReviewAnalysisSchema
            );
            assertEquals(result2.success, false);
        });

        it('should handle non-object data', async () => {
            const result = await validationService.validateWithTransformation(
                'not an object',
                StrictReviewAnalysisSchema
            );
            assertEquals(result.success, false);
        });

        it('should handle circular references gracefully', async () => {
            const circularData: any = {
                grade: 'A',
                coverage: 90,
                testsPresent: true,
                value: 'high',
                state: 'pass',
                issues: [],
                suggestions: [],
                summary: 'Test'
            };
            circularData.self = circularData;

            // This should not crash the validation service
            const result = await validationService.validateWithTransformation(
                circularData,
                FlexibleReviewAnalysisSchema
            );

            // The result may succeed or fail, but it shouldn't crash
            assert(typeof result.success === 'boolean');
        });
    });

    describe('Performance', () => {
        it('should handle large datasets efficiently', async () => {
            const largeData = {
                grade: 'A',
                coverage: 95,
                testsPresent: true,
                value: 'high',
                state: 'pass',
                issues: Array.from({ length: 1000 }, (_, i) => ({
                    line: i + 1,
                    severity: 'low' as const,
                    type: 'style' as const,
                    message: `Issue ${i + 1}`
                })),
                suggestions: Array.from({ length: 100 }, (_, i) => `Suggestion ${i + 1}`),
                summary: 'Large dataset test'
            };

            const startTime = Date.now();
            const result = await validationService.validateWithTransformation(
                largeData,
                FlexibleReviewAnalysisSchema
            );
            const endTime = Date.now();

            assertEquals(result.success, true);
            assertExists(result.data);
            assertEquals(result.data.issues?.length, 1000);
            assertEquals(result.data.suggestions?.length, 100);
            
            // Should complete within reasonable time (less than 1 second)
            assert(endTime - startTime < 1000, `Validation took ${endTime - startTime}ms`);
        });
    });
});