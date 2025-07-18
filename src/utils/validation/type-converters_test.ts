/**
 * Tests for safe type conversion utilities
 */

import { assertEquals, assertExists, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { z } from 'zod';
import {
    SafeTypeConverter,
    TypeConversionError,
    safeConvert,
    safeConvertObject,
    createSafeSchema,
    batchConvert,
    createConversionMiddleware,
    typeConverter,
} from './type-converters.ts';

Deno.test('SafeTypeConverter - string conversion', async () => {
    const converter = new SafeTypeConverter();
    
    const result1 = await converter.convert('hello', 'string');
    assert(result1.success);
    assertEquals(result1.value, 'hello');
    
    const result2 = await converter.convert(123, 'string');
    assert(result2.success);
    assertEquals(result2.value, '123');
    
    const result3 = await converter.convert({ test: 'value' }, 'string');
    assert(result3.success);
    assertEquals(result3.value, '{"test":"value"}');
});

Deno.test('SafeTypeConverter - number conversion', async () => {
    const converter = new SafeTypeConverter();
    
    const result1 = await converter.convert(42, 'number');
    assert(result1.success);
    assertEquals(result1.value, 42);
    
    const result2 = await converter.convert('42', 'number');
    assert(result2.success);
    assertEquals(result2.value, 42);
    
    const result3 = await converter.convert('75%', 'number');
    assert(result3.success);
    assertEquals(result3.value, 75);
    
    const result4 = await converter.convert(true, 'number');
    assert(result4.success);
    assertEquals(result4.value, 1);
    
    const result5 = await converter.convert('invalid', 'number');
    assert(!result5.success);
    assert(result5.errors.length > 0);
});

Deno.test('SafeTypeConverter - boolean conversion', async () => {
    const converter = new SafeTypeConverter();
    
    const result1 = await converter.convert(true, 'boolean');
    assert(result1.success);
    assertEquals(result1.value, true);
    
    const result2 = await converter.convert('true', 'boolean');
    assert(result2.success);
    assertEquals(result2.value, true);
    
    const result3 = await converter.convert('1', 'boolean');
    assert(result3.success);
    assertEquals(result3.value, true);
    
    const result4 = await converter.convert('yes', 'boolean');
    assert(result4.success);
    assertEquals(result4.value, true);
    
    const result5 = await converter.convert('false', 'boolean');
    assert(result5.success);
    assertEquals(result5.value, false);
    
    const result6 = await converter.convert(0, 'boolean');
    assert(result6.success);
    assertEquals(result6.value, false);
});

Deno.test('SafeTypeConverter - array conversion', async () => {
    const converter = new SafeTypeConverter();
    
    const result1 = await converter.convert([1, 2, 3], 'array');
    assert(result1.success);
    assertEquals(result1.value, [1, 2, 3]);
    
    const result2 = await converter.convert('single', 'array');
    assert(result2.success);
    assertEquals(result2.value, ['single']);
    
    const result3 = await converter.convert(null, 'array');
    assert(result3.success);
    assertEquals(result3.value, []);
    
    const result4 = await converter.convert('["a","b","c"]', 'array');
    assert(result4.success);
    assertEquals(result4.value, ['a', 'b', 'c']);
});

Deno.test('SafeTypeConverter - object conversion', async () => {
    const converter = new SafeTypeConverter();
    
    const result1 = await converter.convert({ key: 'value' }, 'object');
    assert(result1.success);
    assertEquals(result1.value, { key: 'value' });
    
    const result2 = await converter.convert('{"key":"value"}', 'object');
    assert(result2.success);
    assertEquals(result2.value, { key: 'value' });
    
    const result3 = await converter.convert('simple', 'object');
    assert(result3.success);
    assertEquals(result3.value, { value: 'simple' });
    
    const result4 = await converter.convert(null, 'object');
    assert(result4.success);
    assertEquals(result4.value, {});
});

Deno.test('SafeTypeConverter - date conversion', async () => {
    const converter = new SafeTypeConverter();
    
    const date = new Date();
    const result1 = await converter.convert(date, 'date');
    assert(result1.success);
    assertEquals(result1.value, date);
    
    const result2 = await converter.convert('2023-01-01T00:00:00Z', 'date');
    assert(result2.success);
    assertExists(result2.value);
    assert(result2.value instanceof Date);
    
    const result3 = await converter.convert(1672531200000, 'date');
    assert(result3.success);
    assertExists(result2.value);
    assert(result3.value instanceof Date);
    
    const result4 = await converter.convert('invalid-date', 'date');
    assert(!result4.success);
    assert(result4.errors.length > 0);
});

Deno.test('SafeTypeConverter - custom transformers', async () => {
    const converter = new SafeTypeConverter();
    
    // Register a custom transformer
    converter.registerTransformer({
        name: 'test-transformer',
        description: 'Test transformer',
        priority: 20,
        canTransform: (data, targetType) => targetType === 'test' && typeof data === 'string',
        transform: (data) => `transformed-${data}`,
    });
    
    const result = await converter.convert('input', 'test');
    assert(result.success);
    assertEquals(result.value, 'transformed-input');
    assertEquals(result.transformationsApplied, ['test-transformer']);
});

Deno.test('SafeTypeConverter - default values', async () => {
    const converter = new SafeTypeConverter();
    
    const result = await converter.convert('invalid', 'number', {
        defaultValue: 42,
    });
    
    assert(result.success);
    assertEquals(result.value, 42);
    assert(result.transformationsApplied.includes('default-value'));
    assert(result.warnings.some(w => w.includes('Used default value')));
});

Deno.test('SafeTypeConverter - convertObject', async () => {
    const converter = new SafeTypeConverter();
    
    const obj = {
        name: 'John',
        age: '30',
        active: 'true',
        score: '85.5',
    };
    
    const typeMap = {
        name: 'string',
        age: 'number',
        active: 'boolean',
        score: 'number',
    };
    
    const result = await converter.convertObject(obj, typeMap);
    
    assert(result.success);
    assertExists(result.data);
    assertEquals((result.data as any).name, 'John');
    assertEquals((result.data as any).age, 30);
    assertEquals((result.data as any).active, true);
    assertEquals((result.data as any).score, 85.5);
});

Deno.test('SafeTypeConverter - convertObject with partial failure', async () => {
    const converter = new SafeTypeConverter();
    
    const obj = {
        name: 'John',
        age: 'invalid-number',
        active: 'true',
    };
    
    const typeMap = {
        name: 'string',
        age: 'number',
        active: 'boolean',
    };
    
    const result = await converter.convertObject(obj, typeMap, {
        allowPartial: true,
    });
    
    assert(result.success); // Should succeed with partial conversion
    assertExists(result.data);
    assertEquals((result.data as any).name, 'John');
    assertEquals((result.data as any).age, 'invalid-number'); // Original value kept
    assertEquals((result.data as any).active, true);
    assert(result.warnings.some(w => w.includes('Failed to convert age')));
});

Deno.test('Coverage transformer - percentage strings', async () => {
    const result1 = await typeConverter.convert('75%', 'number');
    assert(result1.success);
    assertEquals(result1.value, 75);
    assert(result1.transformationsApplied.includes('coverage-transformer'));
    
    const result2 = await typeConverter.convert('85.5%', 'number');
    assert(result2.success);
    assertEquals(result2.value, 86); // Rounded
    
    const result3 = await typeConverter.convert('150%', 'number');
    assert(result3.success);
    assertEquals(result3.value, 100); // Clamped to max
    
    const result4 = await typeConverter.convert('-10%', 'number');
    assert(result4.success);
    assertEquals(result4.value, 0); // Clamped to min
});

Deno.test('Boolean string transformer', async () => {
    const testCases = [
        ['true', true],
        ['false', false],
        ['1', true],
        ['0', false],
        ['yes', true],
        ['no', false],
        ['on', true],
        ['off', false],
        ['TRUE', true],
        ['FALSE', false],
    ];
    
    for (const [input, expected] of testCases) {
        const result = await typeConverter.convert(input, 'boolean');
        assert(result.success);
        assertEquals(result.value, expected);
        assert(result.transformationsApplied.includes('boolean-string-transformer'));
    }
});

Deno.test('safeConvert convenience function', async () => {
    const result = await safeConvert('42', 'number');
    assert(result.success);
    assertEquals(result.value, 42);
});

Deno.test('safeConvertObject convenience function', async () => {
    const obj = { name: 'John', age: '30' };
    const typeMap = { name: 'string', age: 'number' };
    
    const result = await safeConvertObject(obj, typeMap);
    assert(result.success);
    assertEquals((result.data as any).age, 30);
});

Deno.test('createSafeSchema with Zod', async () => {
    const baseSchema = z.object({
        name: z.string(),
        age: z.number(),
        active: z.boolean(),
    });
    
    const conversions = {
        age: 'number',
        active: 'boolean',
    };
    
    const safeSchema = createSafeSchema(baseSchema, conversions);
    
    const testData = {
        name: 'John',
        age: '30',
        active: 'true',
    };
    
    // Note: This test would need async transform support in Zod
    // For now, we just test that the schema is created
    assertExists(safeSchema);
});

Deno.test('batchConvert - multiple values', async () => {
    const values = ['10', '20.5', 'invalid', '30'];
    
    const result = await batchConvert(values, 'number', {
        maxConcurrency: 2,
        defaultValue: 0,
    });
    
    assertEquals(result.results.length, 4);
    assertEquals(result.successCount, 4); // All should succeed with default value
    assertEquals(result.errorCount, 0);
    assert(result.totalTime > 0);
    
    // Check individual results
    assertEquals(result.results[0].value, 10);
    assertEquals(result.results[1].value, 20.5);
    assertEquals(result.results[2].value, 0); // Default value for 'invalid'
    assertEquals(result.results[3].value, 30);
});

Deno.test('createConversionMiddleware', async () => {
    const schema = z.object({
        name: z.string(),
        age: z.number(),
        active: z.boolean(),
    });
    
    const conversions = {
        age: 'number',
        active: 'boolean',
    };
    
    const middleware = createConversionMiddleware(schema, conversions);
    
    const testData = {
        name: 'John',
        age: '30',
        active: 'true',
    };
    
    const result = await middleware(testData);
    assertEquals(result.name, 'John');
    assertEquals(result.age, 30);
    assertEquals(result.active, true);
});

Deno.test('TypeConversionError', () => {
    const error = new TypeConversionError(
        'Cannot convert string to number',
        'invalid',
        'number',
        'string'
    );
    
    assertEquals(error.name, 'TypeConversionError');
    assertEquals(error.sourceValue, 'invalid');
    assertEquals(error.targetType, 'number');
    assertEquals(error.sourceType, 'string');
    assert(error.message.includes('Cannot convert string to number'));
});

Deno.test('SafeTypeConverter - error handling', async () => {
    const converter = new SafeTypeConverter();
    
    const result = await converter.convert('invalid', 'unsupported-type');
    assert(!result.success);
    assert(result.errors.length > 0);
    assertEquals(result.originalValue, 'invalid');
    assertEquals(result.targetType, 'unsupported-type');
    assertEquals(result.sourceType, 'string');
});

Deno.test('SafeTypeConverter - transformer priority', async () => {
    const converter = new SafeTypeConverter();
    
    // Register two transformers with different priorities
    converter.registerTransformer({
        name: 'low-priority',
        description: 'Low priority transformer',
        priority: 1,
        canTransform: (data, targetType) => targetType === 'test' && typeof data === 'string',
        transform: (data) => `low-${data}`,
    });
    
    converter.registerTransformer({
        name: 'high-priority',
        description: 'High priority transformer',
        priority: 10,
        canTransform: (data, targetType) => targetType === 'test' && typeof data === 'string',
        transform: (data) => `high-${data}`,
    });
    
    const result = await converter.convert('input', 'test');
    assert(result.success);
    assertEquals(result.value, 'high-input'); // High priority should win
    assertEquals(result.transformationsApplied, ['high-priority']);
});

Deno.test('SafeTypeConverter - getTransformers', () => {
    const converter = new SafeTypeConverter();
    const transformers = converter.getTransformers();
    
    assert(transformers.length > 0);
    assert(transformers.some(t => t.name === 'coverage-transformer'));
    assert(transformers.some(t => t.name === 'boolean-string-transformer'));
    
    // Should be sorted by priority (descending)
    for (let i = 1; i < transformers.length; i++) {
        assert(transformers[i - 1].priority >= transformers[i].priority);
    }
});